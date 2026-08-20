/**
 * OpenFireWatch — end-to-end integration test.
 *
 * Verifies the ENTIRE event-driven flow against real infrastructure
 * (the docker-compose PostGIS + Redis, on isolated test resources):
 *
 *   HTTP POST /api/simulate-fire
 *     → BullMQ queue (`events.detection-reports`, Redis DB 15)
 *       → AnomalyEvaluationService (DTO re-validation)
 *         → PostGIS persistence + ST_Intersects zone check
 *           → CRITICAL_PHOSPHORUS_FIRE escalation in `validated_events`
 *             → Redis pub/sub → AlertsGateway → Socket.IO emit (mocked & spied)
 *
 * The pipeline is asynchronous BY DESIGN — the HTTP response is 202 Accepted
 * and the assertions poll the database until the event settles (bounded by
 * the Jest timeout). Nothing in the pipeline itself is mocked except the
 * outermost Socket.IO server, which we replace with a spy to assert the
 * exact payload that would reach the Angular frontend.
 *
 * Prerequisites: `docker compose up -d db redis` (ports 5432/6379 on host).
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { readFileSync } from 'fs';
import IORedis from 'ioredis';
import { join } from 'path';
import { Client, Pool } from 'pg';
import request from 'supertest';

import { AlertsGateway } from '../src/alerts/alerts.gateway';
import { AppModule } from '../src/app.module';

const TEST_DB = 'openfirewatch_e2e';
const OPERATOR_KEY = process.env.OPERATOR_API_KEY!;

/** Must mirror SimulationController.FOEHRENWALD_CENTER and the seeded zone. */
const DRILL_LON = 16.2155;
const DRILL_LAT = 47.7593;
const ZONE_NAME = {
  en: 'Föhrenwald (Steinfeld) — demo hazard zone',
  de: 'Föhrenwald (Steinfeld) — Demo-Gefahrenzone',
};

/** Poll until `probe` returns a defined value, or fail after `timeoutMs`. */
async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 20_000,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('OpenFireWatch pipeline (e2e)', () => {
  let app: INestApplication;
  let db: Pool; // test-side connection for assertions
  let redis: IORedis; // test-side handle for cleanup
  let reportsQueue: Queue; // direct producer for non-HTTP test cases
  let emitSpy: jest.Mock; // the mocked Socket.IO `server.emit`

  beforeAll(async () => {
    const pgAdminConfig = {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    };

    // --- 1) Fresh, isolated test database per run ---------------------------
    const admin = new Client({ ...pgAdminConfig, database: 'postgres' });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);`);
    await admin.query(`CREATE DATABASE ${TEST_DB};`);
    await admin.end();

    // Apply the canonical schema (same file the compose db runs on first boot).
    const initSql = readFileSync(
      join(__dirname, '..', '..', 'deploy', 'db', 'init.sql'),
      'utf8',
    );
    const schema = new Client({ ...pgAdminConfig, database: TEST_DB });
    await schema.connect();
    await schema.query(initSql);
    await schema.end();

    db = new Pool({ ...pgAdminConfig, database: TEST_DB, max: 3 });

    // --- 2) Clean, isolated Redis logical DB --------------------------------
    redis = new IORedis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      db: Number(process.env.REDIS_DB),
    });
    await redis.flushdb();

    // Direct producer used by the non-HTTP test cases below.
    reportsQueue = new Queue('events.detection-reports', {
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        db: Number(process.env.REDIS_DB),
        maxRetriesPerRequest: null,
      },
    });

    // --- 3) Bootstrap the REAL application ----------------------------------
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror the production bootstrap (main.ts) so routes/validation match.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    // --- 4) Mock ONLY the outermost edge: the Socket.IO server ---------------
    // Everything up to the gateway runs for real; we intercept the final
    // `server.emit(...)` to assert exactly what browsers would receive.
    emitSpy = jest.fn();
    const gateway = app.get(AlertsGateway);
    (gateway as unknown as { server: { emit: jest.Mock } }).server = {
      emit: emitSpy,
    };
  });

  beforeEach(async () => {
    // Deterministic per-test state: empty event tables, pristine spy.
    await db.query('TRUNCATE validated_events, thermal_anomalies RESTART IDENTITY CASCADE;');
    emitSpy.mockClear();
  });

  afterAll(async () => {
    // Teardown order matters: app first (closes its BullMQ worker, Redis
    // subscriber/publisher, and pg pool), then our test-side handles.
    await app?.close();
    await reportsQueue?.close();
    await redis?.flushdb();
    await redis?.quit();
    await db?.end();
  });

  it('POST /api/simulate-fire escalates to CRITICAL_PHOSPHORUS_FIRE end-to-end', async () => {
    // --- Act: the same call a developer makes with curl ----------------------
    const response = await request(app.getHttpServer())
      .post('/api/simulate-fire')
      .set('X-API-Key', OPERATOR_KEY) // the drill is a write: it is guarded
      .expect(202); // processing is asynchronous by design

    expect(response.body.injected.weather).toEqual(
      expect.objectContaining({ temperatureC: 32, soilMoisturePct: 15 }),
    );

    // --- Assert: the pipeline settles into the database ----------------------
    const validated = await waitFor(
      async () => {
        const { rows } = await db.query(
          `SELECT anomaly_id, zone_id, alert_level, temperature_c, soil_moisture_pct
           FROM validated_events;`,
        );
        return rows.length > 0 ? rows : undefined;
      },
      20_000,
      'validated_events row',
    );

    // Exactly ONE anomaly was saved and flagged CRITICAL, inside a zone.
    expect(validated).toHaveLength(1);
    expect(validated[0]).toEqual(
      expect.objectContaining({
        alert_level: 'CRITICAL_PHOSPHORUS_FIRE',
        temperature_c: 32,
        soil_moisture_pct: 15,
      }),
    );
    expect(validated[0].zone_id).not.toBeNull();

    const anomalies = await db.query(
      `SELECT source, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM thermal_anomalies;`,
    );
    expect(anomalies.rows).toHaveLength(1);
    expect(anomalies.rows[0]).toEqual(
      expect.objectContaining({ source: 'MANUAL_SIMULATION', lon: DRILL_LON, lat: DRILL_LAT }),
    );

    // --- Assert: the WebSocket edge received the correct payload -------------
    const expectedAlert = expect.objectContaining({
      type: 'thermal_anomaly',
      level: 'CRITICAL_PHOSPHORUS_FIRE',
      latitude: DRILL_LAT,
      longitude: DRILL_LON,
      weather: { temperatureC: 32, soilMoisturePct: 15 },
      zone: expect.objectContaining({
        hazardType: 'white_phosphorus',
        // Zone labels ship in EVERY language: one alert is broadcast to all
        // clients at once, so the client — not the server — localizes.
        name: ZONE_NAME,
      }),
    });
    // Broadcast on the general feed AND the dedicated life-safety event.
    expect(emitSpy).toHaveBeenCalledWith('anomaly:new', expectedAlert);
    expect(emitSpy).toHaveBeenCalledWith('alert:critical', expectedAlert);
  });

  it('GET /api/risk-zones serves the hazard polygons as GeoJSON', async () => {
    // The frontend draws its overlay from this response, so a zone added by
    // an operator must appear here without any code change or redeploy.
    const response = await request(app.getHttpServer())
      .get('/api/risk-zones')
      .expect(200);

    expect(response.body.type).toBe('FeatureCollection');
    expect(response.body.features).toHaveLength(1);

    const [zone] = response.body.features;
    expect(zone.geometry.type).toBe('Polygon');
    // Closed ring of [longitude, latitude] pairs (GeoJSON axis order).
    expect(zone.geometry.coordinates[0][0]).toEqual(
      zone.geometry.coordinates[0].at(-1),
    );
    expect(zone.properties).toEqual(
      expect.objectContaining({ hazardType: 'white_phosphorus', name: ZONE_NAME }),
    );
    // The seeded demo polygon must contain the coordinates the drill injects.
    const ring: number[][] = zone.geometry.coordinates[0];
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    expect(Math.min(...lons)).toBeLessThan(DRILL_LON);
    expect(Math.max(...lons)).toBeGreaterThan(DRILL_LON);
    expect(Math.min(...lats)).toBeLessThan(DRILL_LAT);
    expect(Math.max(...lats)).toBeGreaterThan(DRILL_LAT);
  });

  it('returns a valid empty FeatureCollection when there is no data', async () => {
    // The state of every FRESH deployment. `json_agg` over zero rows is NULL,
    // so a misplaced COALESCE silently emits "features": null — not valid
    // GeoJSON, and the map calls setData() with it before any detection exists.
    // beforeEach has truncated the anomaly tables, so this is that state.
    const anomalies = await request(app.getHttpServer())
      .get('/api/anomalies?limit=10')
      .expect(200);
    expect(anomalies.body).toEqual({ type: 'FeatureCollection', features: [] });

    await db.query('UPDATE high_risk_zones SET is_active = FALSE;');
    try {
      const zones = await request(app.getHttpServer())
        .get('/api/risk-zones')
        .expect(200);
      expect(zones.body).toEqual({ type: 'FeatureCollection', features: [] });
    } finally {
      await db.query('UPDATE high_risk_zones SET is_active = TRUE;');
    }
  });

  describe('current conditions', () => {
    it('reports honestly when no ingestion cycle has run', async () => {
      // A fresh deployment. Guessing values here would be worse than a gap:
      // the panel must be able to say "unknown", not show stale weather.
      await redis.del('conditions:current');
      const res = await request(app.getHttpServer()).get('/api/conditions').expect(200);

      expect(res.body.available).toBe(false);
      expect(res.body.temperatureC).toBeUndefined();
      // Zones are still listed — the map should show them regardless.
      expect(res.body.zones.length).toBeGreaterThan(0);
    });

    it('measures each zone against ITS OWN threshold, not one global rule', async () => {
      await redis.set(
        'conditions:current',
        JSON.stringify({
          observedAt: new Date().toISOString(),
          cycleAt: new Date().toISOString(),
          temperatureC: 24,
          relativeHumidityPct: 55,
          soilMoisturePct: 31,
          stationId: '11090',
          area: '16,47,17,48',
        }),
      );
      // A wildfire zone alongside the seeded phosphorus one.
      await db.query(
        `INSERT INTO high_risk_zones (name, name_en, name_de, hazard_type, geom)
         VALUES ('e2e-conditions', 'E2E wildfire', 'E2E-Waldbrand', 'wildfire',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
         ON CONFLICT (name) DO UPDATE SET hazard_type = EXCLUDED.hazard_type;`,
        [JSON.stringify({
          type: 'Polygon',
          coordinates: [[[16.48,47.92],[16.52,47.92],[16.52,47.88],[16.48,47.88],[16.48,47.92]]],
        })],
      );

      try {
        const res = await request(app.getHttpServer()).get('/api/conditions').expect(200);
        expect(res.body.available).toBe(true);
        expect(res.body.temperatureC).toBe(24);

        const phosphorus = res.body.zones.find(
          (z: { hazardType: string }) => z.hazardType === 'white_phosphorus',
        );
        const wildfire = res.body.zones.find(
          (z: { hazardType: string }) => z.hazardType === 'wildfire',
        );

        // 24 °C is 6 below the 30 °C threshold; 31 % soil is 11 above the 20 %.
        expect(phosphorus.gate).toBe('weather');
        expect(phosphorus.armed).toBe(false);
        expect(phosphorus.temperatureGapC).toBe(6);
        expect(phosphorus.soilMoistureGapPct).toBe(11);

        // The wildfire zone does not wait for weather at all.
        expect(wildfire.gate).toBe('detection');
        expect(wildfire.armed).toBe(true);
        expect(wildfire.temperatureGapC).toBeUndefined();
      } finally {
        await db.query(`DELETE FROM high_risk_zones WHERE name = 'e2e-conditions';`);
        await redis.del('conditions:current');
      }
    });

    it('arms a phosphorus zone once both thresholds are crossed', async () => {
      await redis.set(
        'conditions:current',
        JSON.stringify({
          observedAt: new Date().toISOString(),
          cycleAt: new Date().toISOString(),
          temperatureC: 33,
          relativeHumidityPct: 20,
          soilMoisturePct: 12,
          stationId: '11090',
          area: '16,47,17,48',
        }),
      );
      try {
        const res = await request(app.getHttpServer()).get('/api/conditions').expect(200);
        const phosphorus = res.body.zones.find(
          (z: { hazardType: string }) => z.hazardType === 'white_phosphorus',
        );
        expect(phosphorus.armed).toBe(true);
      } finally {
        await redis.del('conditions:current');
      }
    });
  });

  describe('alert history', () => {
    it('serves past evaluations that the live socket has already forgotten', async () => {
      // The point of the endpoint: a browser that was not open when the alert
      // fired — or one that was simply reloaded — must still see it.
      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);

      const history = await waitFor(
        async () => {
          const res = await request(app.getHttpServer())
            .get('/api/alerts?limit=10')
            .expect(200);
          return res.body.length > 0 ? res.body : undefined;
        },
        20_000,
        'alert history entry',
      );

      expect(history[0]).toEqual(
        expect.objectContaining({
          type: 'thermal_anomaly',
          level: 'CRITICAL_PHOSPHORUS_FIRE',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          weather: { temperatureC: 32, soilMoisturePct: 15 },
          zone: expect.objectContaining({ name: ZONE_NAME }),
        }),
      );
      // evaluatedAt is what distinguishes a history entry from a live alert.
      expect(Date.parse(history[0].evaluatedAt)).not.toBeNaN();
    });

    it('keeps INFO events, so "detected but outside every zone" stays visible', async () => {
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_HISTORY', satellite: 'TEST',
          latitude: 47.0, longitude: 15.0,   // far from any zone
          acquiredAt: new Date().toISOString(),
          brightnessK: 340, frpMw: 10, confidence: 'h',
        },
        weather: {
          temperatureC: 35, soilMoisturePct: 10,
          windSpeedKmh: 5, observedAt: new Date().toISOString(),
        },
      });

      const all = await waitFor(
        async () => {
          const res = await request(app.getHttpServer()).get('/api/alerts?limit=10');
          const info = res.body.filter((e: { level: string }) => e.level === 'INFO');
          return info.length > 0 ? info : undefined;
        },
        20_000,
        'INFO history entry',
      );
      // A LEFT JOIN failure here would silently drop these entirely.
      expect(all[0].zone).toBeNull();
    });

    it('criticalOnly filters out everything below a critical level', async () => {
      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      await waitFor(
        async () => {
          const res = await request(app.getHttpServer()).get('/api/alerts?criticalOnly=true');
          return res.body.length > 0 ? res.body : undefined;
        },
        20_000,
        'critical-only history',
      );

      const res = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true')
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const entry of res.body) {
        expect(entry.level).toMatch(/^CRITICAL_/);
      }
    });

    it('rejects an out-of-range limit instead of trusting it', async () => {
      await request(app.getHttpServer()).get('/api/alerts?limit=99999').expect(400);
    });
  });

  describe('per-hazard escalation criteria', () => {
    /** Enqueue one report at a coordinate and wait for its verdict. */
    const evaluate = async (
      lon: number,
      lat: number,
      weather: { temperatureC: number; soilMoisturePct: number },
      confidence: string,
    ): Promise<string> => {
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_HAZARD',
          satellite: 'TEST',
          latitude: lat,
          longitude: lon,
          acquiredAt: new Date().toISOString(),
          brightnessK: 340,
          frpMw: 12,
          confidence,
        },
        weather: { ...weather, windSpeedKmh: 5, observedAt: new Date().toISOString() },
      });
      const rows = await waitFor(
        async () => {
          const { rows } = await db.query(`SELECT alert_level FROM validated_events;`);
          return rows.length > 0 ? rows : undefined;
        },
        20_000,
        'evaluation verdict',
      );
      return rows[0].alert_level;
    };

    /** A second zone with a different hazard type, well clear of the first. */
    const WILDFIRE_ZONE = {
      lon: 16.5,
      lat: 47.9,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [16.48, 47.92],
            [16.52, 47.92],
            [16.52, 47.88],
            [16.48, 47.88],
            [16.48, 47.92],
          ],
        ],
      },
    };

    const addZone = async (hazardType: string): Promise<void> => {
      await db.query(
        `INSERT INTO high_risk_zones (name, name_en, name_de, hazard_type, geom)
         VALUES ('e2e-hazard', 'E2E hazard', 'E2E-Gefahr', $1,
                 ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
         ON CONFLICT (name) DO UPDATE
           SET hazard_type = EXCLUDED.hazard_type, is_active = TRUE;`,
        [hazardType, JSON.stringify(WILDFIRE_ZONE.polygon)],
      );
    };

    afterEach(async () => {
      // The evaluation rows reference the zone, and the schema deliberately
      // refuses to delete a zone that has alert history — clear the events
      // first. (Production retires zones instead; see RiskZoneService.)
      await db.query('TRUNCATE validated_events, thermal_anomalies RESTART IDENTITY CASCADE;');
      await db.query(`DELETE FROM high_risk_zones WHERE name = 'e2e-hazard';`);
    });

    it('escalates a wildfire zone on cool, damp weather that phosphorus rules would veto', async () => {
      // 12 °C and 60 % soil moisture: the phosphorus gate would refuse this.
      // A forest hotspot is a fire regardless of the air temperature.
      await addZone('wildfire');
      const level = await evaluate(
        WILDFIRE_ZONE.lon,
        WILDFIRE_ZONE.lat,
        { temperatureC: 12, soilMoisturePct: 60 },
        'h',
      );
      expect(level).toBe('CRITICAL_WILDFIRE');
    });

    it('holds a wildfire zone at ELEVATED when the satellite rates the pixel low', async () => {
      await addZone('wildfire');
      const level = await evaluate(
        WILDFIRE_ZONE.lon,
        WILDFIRE_ZONE.lat,
        { temperatureC: 35, soilMoisturePct: 5 },
        'l',
      );
      expect(level).toBe('ELEVATED');
    });

    it('escalates an ammunition site unconditionally — even on a low-confidence pixel', async () => {
      // Deliberately the most conservative profile: a false alarm at an
      // ordnance site is far cheaper than a missed one.
      await addZone('ammunition_depot');
      const level = await evaluate(
        WILDFIRE_ZONE.lon,
        WILDFIRE_ZONE.lat,
        { temperatureC: 4, soilMoisturePct: 80 },
        'l',
      );
      expect(level).toBe('CRITICAL_ORDNANCE_HEAT');
    });

    it('keeps the weather gate for white phosphorus', async () => {
      await addZone('white_phosphorus');
      expect(
        await evaluate(
          WILDFIRE_ZONE.lon,
          WILDFIRE_ZONE.lat,
          { temperatureC: 12, soilMoisturePct: 60 },
          'h',
        ),
      ).toBe('ELEVATED');
    });

    it('falls back to the generic profile for an unknown hazard type', async () => {
      await addZone('something_new');
      const level = await evaluate(
        WILDFIRE_ZONE.lon,
        WILDFIRE_ZONE.lat,
        { temperatureC: 20, soilMoisturePct: 40 },
        'n',
      );
      expect(level).toBe('CRITICAL_THERMAL_ANOMALY');
    });
  });

  describe('smouldering nest detection', () => {
    const LON = 16.5;
    const LAT = 47.9;
    const POLY = {
      type: 'Polygon',
      coordinates: [[[16.48, 47.92], [16.52, 47.92], [16.52, 47.88], [16.48, 47.88], [16.48, 47.92]]],
    };

    /** Insert a past detection directly — the history the analysis reads. */
    const seedPast = async (hoursAgo: number, frpMw: number, offsetDeg = 0) => {
      await db.query(
        `INSERT INTO thermal_anomalies (source, geom, acquired_at, frp_mw, confidence)
         VALUES ('E2E_PAST', ST_SetSRID(ST_MakePoint($1, $2), 4326),
                 now() - ($3 || ' hours')::interval, $4, 'n');`,
        [LON + offsetDeg, LAT, hoursAgo, frpMw],
      );
    };

    const evaluateNow = async (frpMw: number): Promise<string> => {
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_SMOULDER', satellite: 'TEST',
          latitude: LAT, longitude: LON,
          acquiredAt: new Date().toISOString(),
          brightnessK: 320, frpMw, confidence: 'n',
        },
        weather: {
          temperatureC: 10, soilMoisturePct: 70,
          windSpeedKmh: 3, observedAt: new Date().toISOString(),
        },
      });
      const rows = await waitFor(
        async () => {
          const { rows } = await db.query(
            `SELECT alert_level FROM validated_events ORDER BY id DESC LIMIT 1;`);
          return rows.length > 0 ? rows : undefined;
        },
        20_000, 'smouldering verdict');
      return rows[0].alert_level;
    };

    beforeEach(async () => {
      await db.query(
        `INSERT INTO high_risk_zones (name, name_en, name_de, hazard_type, geom)
         VALUES ('e2e-smoulder', 'E2E smoulder', 'E2E-Glut', 'wildfire',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
         ON CONFLICT (name) DO UPDATE SET is_active = TRUE;`,
        [JSON.stringify(POLY)],
      );
    });

    afterEach(async () => {
      await db.query('TRUNCATE validated_events, thermal_anomalies RESTART IDENTITY CASCADE;');
      await db.query(`DELETE FROM high_risk_zones WHERE name = 'e2e-smoulder';`);
    });

    it('flags a weak source that persisted across separate passes', async () => {
      await seedPast(30, 1.2);   // two earlier passes at the same spot,
      await seedPast(10, 0.8);   // both low-power
      expect(await evaluateNow(0.9)).toBe('CRITICAL_SMOULDERING');
    });

    it('does not flag a single isolated weak detection', async () => {
      // Nothing in the history — one weak pass is just a detection.
      expect(await evaluateNow(0.9)).toBe('CRITICAL_WILDFIRE');
    });

    it('does not downgrade an active fire that breaks out where embers were', async () => {
      // The dangerous direction: a strong new detection must NOT inherit the
      // weak history and be reported as a mere smouldering nest.
      await seedPast(30, 1.2);
      await seedPast(10, 0.8);
      expect(await evaluateNow(80)).toBe('CRITICAL_WILDFIRE');
    });

    it('ignores weak history that is too far away to be the same nest', async () => {
      // ~4 km east — beyond the 500 m clustering radius.
      await seedPast(30, 1.2, 0.05);
      await seedPast(10, 0.8, 0.05);
      expect(await evaluateNow(0.9)).toBe('CRITICAL_WILDFIRE');
    });

    it('ignores history older than the look-back window', async () => {
      await seedPast(200, 1.2);  // ~8 days ago, window is 72 h
      await seedPast(180, 0.8);
      expect(await evaluateNow(0.9)).toBe('CRITICAL_WILDFIRE');
    });
  });

  describe('hazard-zone management', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [16.4, 47.9],
          [16.48, 47.9],
          [16.48, 47.86],
          [16.4, 47.86],
          [16.4, 47.9],
        ],
      ],
    };
    const body = {
      nameEn: 'E2E Zone',
      nameDe: 'E2E-Zone',
      hazardType: 'wildfire',
      geometry: polygon,
    };

    afterEach(async () => {
      // Zones live outside the per-test TRUNCATE, so clean up explicitly.
      await db.query(`DELETE FROM high_risk_zones WHERE name LIKE 'e2e-zone%';`);
    });

    it('refuses writes without a valid API key, but keeps reads public', async () => {
      await request(app.getHttpServer()).post('/api/risk-zones').send(body).expect(401);
      await request(app.getHttpServer())
        .post('/api/risk-zones')
        .set('X-API-Key', 'wrong-key')
        .send(body)
        .expect(401);
      await request(app.getHttpServer()).get('/api/risk-zones').expect(200);
    });

    it('rejects malformed geometry with an actionable message', async () => {
      const unclosed = await request(app.getHttpServer())
        .post('/api/risk-zones')
        .set('X-API-Key', OPERATOR_KEY)
        .send({ ...body, geometry: { type: 'Polygon', coordinates: [polygon.coordinates[0].slice(0, 3)] } })
        .expect(400);
      expect(JSON.stringify(unclosed.body.message)).toContain('at least 4 positions');

      const outOfBounds = await request(app.getHttpServer())
        .post('/api/risk-zones')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          ...body,
          geometry: {
            type: 'Polygon',
            coordinates: [[[200, 47], [201, 47], [201, 48], [200, 48], [200, 47]]],
          },
        })
        .expect(400);
      expect(JSON.stringify(outOfBounds.body.message)).toContain('WGS84 bounds');
    });

    it('creates a zone that immediately appears in the public feed', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/risk-zones')
        .set('X-API-Key', OPERATOR_KEY)
        .send(body)
        .expect(201);
      expect(created.body.id).toEqual(expect.any(Number));

      const feed = await request(app.getHttpServer()).get('/api/risk-zones').expect(200);
      const zone = feed.body.features.find(
        (f: { properties: { id: number } }) => f.properties.id === created.body.id,
      );
      expect(zone.properties.name).toEqual({ en: 'E2E Zone', de: 'E2E-Zone' });
      expect(zone.properties.hazardType).toBe('wildfire');
    });

    it('retires a zone without destroying it', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/risk-zones')
        .set('X-API-Key', OPERATOR_KEY)
        .send(body)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/risk-zones/${created.body.id}`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(204);

      // Gone from the feed…
      const feed = await request(app.getHttpServer()).get('/api/risk-zones').expect(200);
      expect(
        feed.body.features.some(
          (f: { properties: { id: number } }) => f.properties.id === created.body.id,
        ),
      ).toBe(false);

      // …but the row survives, so its alert history stays auditable.
      const { rows } = await db.query(
        `SELECT is_active FROM high_risk_zones WHERE id = $1;`,
        [created.body.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].is_active).toBe(false);
    });
  });

  it('classifies an out-of-zone detection as INFO and does not broadcast', async () => {
    // Hot + dry weather, but coordinates far outside the Föhrenwald polygon:
    // the spatial rule alone must prevent escalation.
    await reportsQueue.add('detection-report', {
      detection: {
        source: 'E2E_TEST',
        satellite: 'TEST',
        latitude: 47.0, // ~90 km south of the zone
        longitude: 15.0,
        acquiredAt: new Date().toISOString(),
        brightnessK: 340,
        frpMw: 10,
        confidence: 'h',
      },
      weather: {
        temperatureC: 35,
        soilMoisturePct: 10,
        windSpeedKmh: 5,
        observedAt: new Date().toISOString(),
      },
    });

    const validated = await waitFor(
      async () => {
        const { rows } = await db.query(
          `SELECT zone_id, alert_level FROM validated_events;`,
        );
        return rows.length > 0 ? rows : undefined;
      },
      20_000,
      'INFO validated_events row',
    );

    expect(validated).toHaveLength(1);
    expect(validated[0].alert_level).toBe('INFO');
    expect(validated[0].zone_id).toBeNull();
    // INFO events are recorded but never pushed to browsers.
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('deduplicates identical satellite passes (same source, pixel, time)', async () => {
    const acquiredAt = new Date().toISOString();
    const duplicateReport = {
      detection: {
        source: 'E2E_TEST',
        satellite: 'TEST',
        latitude: DRILL_LAT,
        longitude: DRILL_LON,
        acquiredAt, // identical timestamp → identical natural key
        brightnessK: 340,
        frpMw: 10,
        confidence: 'h',
      },
      weather: {
        temperatureC: 32,
        soilMoisturePct: 15,
        windSpeedKmh: 5,
        observedAt: acquiredAt,
      },
    };

    // Enqueue the SAME report twice (distinct BullMQ jobs on purpose): the
    // database unique constraint — not the queue — must collapse them.
    await reportsQueue.add('detection-report', duplicateReport);
    await reportsQueue.add('detection-report', duplicateReport);

    await waitFor(
      async () => {
        const { rows } = await db.query(`SELECT id FROM validated_events;`);
        return rows.length > 0 ? rows : undefined;
      },
      20_000,
      'first evaluation of the duplicate pair',
    );
    // Give the second (duplicate) job time to be processed and discarded.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const anomalies = await db.query(`SELECT id FROM thermal_anomalies;`);
    const validated = await db.query(`SELECT id FROM validated_events;`);
    expect(anomalies.rows).toHaveLength(1); // stored exactly once
    expect(validated.rows).toHaveLength(1); // evaluated exactly once
    // Broadcast exactly once per feed (general + dedicated critical event).
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });
});
