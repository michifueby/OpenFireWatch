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
import { APP_CONFIG, AppConfig } from '../src/config/environment';

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
    // A GeoJSON position is [lon, lat] by definition — assert it rather than
    // branch on it, so a malformed ring fails here instead of downstream.
    const lons = ring.map((p) => p[0]!);
    const lats = ring.map((p) => p[1]!);
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

  describe('satellite archive backfill', () => {
    /** A pass in July 2019, well before this system existed. */
    const HISTORIC_AT = '2019-07-25T12:30:00Z';

    // "One run at a time" is a real rule and it works — which means a test
    // that starts one blocks every test after it. Closing them here keeps
    // that gate honest without each test having to remember.
    afterEach(async () => {
      await db.query(`UPDATE backfill_runs SET status = 'done' WHERE status IN ('queued', 'running');`);
    });

    afterAll(async () => {
      await db.query(`DELETE FROM incidents WHERE title LIKE 'E2E backfill%';`);
      await db.query(`DELETE FROM backfill_runs;`);
    });

    it('is operator-only and refuses ranges it cannot honour', async () => {
      await request(app.getHttpServer())
        .post('/api/backfill/satellite')
        .send({ from: '2019-01-01', to: '2019-12-31' })
        .expect(401);

      const refuse = (body: Record<string, string>) =>
        request(app.getHttpServer())
          .post('/api/backfill/satellite')
          .set('X-API-Key', OPERATOR_KEY)
          .send(body)
          .expect(400);
      await refuse({ from: '2019-12-31', to: '2019-01-01' }); // inverted
      await refuse({ from: '2099-01-01', to: '2099-01-02' }); // future
      await refuse({ from: '2005-01-01', to: '2005-12-31' }); // before the archive
      await refuse({ from: '2013-01-01', to: '2025-12-31' }); // longer than one run
      await refuse({ from: '2019-07-01T00:00:00Z', to: '2019-07-02' }); // not a plain date
    });

    it('records a run, hands it to the workers, and allows only one at a time', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/backfill/satellite')
        .set('X-API-Key', OPERATOR_KEY)
        .send({ from: '2019-07-01', to: '2019-07-31' })
        .expect(202);
      expect(res.body).toMatchObject({ status: 'queued', from: '2019-07-01', to: '2019-07-31', requestsDone: 0 });

      // The job is on the backfill queue for the workers to pick up.
      const backfillQueue = new Queue('jobs.backfill', {
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
          db: Number(process.env.REDIS_DB),
        },
      });
      try {
        const job = await backfillQueue.getJob(`satellite-backfill-${res.body.id}`);
        expect(job?.data).toEqual({ runId: res.body.id, from: '2019-07-01', to: '2019-07-31' });
        await job?.remove();
      } finally {
        await backfillQueue.close();
      }

      // A second run while one is queued is refused, not stacked.
      await request(app.getHttpServer())
        .post('/api/backfill/satellite')
        .set('X-API-Key', OPERATOR_KEY)
        .send({ from: '2020-07-01', to: '2020-07-31' })
        .expect(409);

      const list = await request(app.getHttpServer()).get('/api/backfill/satellite').expect(200);
      expect(list.body[0].id).toBe(res.body.id);
    });

    it('evaluates a replayed detection by the same rule but never alarms on it', async () => {
      emitSpy.mockClear();
      // Hot, dry, inside the phosphorus zone: live, this is a critical alert.
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_ARCHIVE',
          satellite: 'TEST',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          acquiredAt: HISTORIC_AT,
          brightnessK: 345,
          frpMw: 9,
          confidence: 'h',
        },
        weather: { temperatureC: 34, soilMoisturePct: 9, observedAt: HISTORIC_AT },
        ingestion: 'backfill',
      });

      const row = await waitFor(
        async () => {
          const { rows } = await db.query<{ alert_level: string; backfilled: boolean }>(
            `SELECT ve.alert_level, ve.backfilled
               FROM validated_events ve JOIN thermal_anomalies a ON a.id = ve.anomaly_id
              WHERE a.source = 'E2E_ARCHIVE' AND a.acquired_at = $1;`,
            [HISTORIC_AT],
          );
          return rows[0];
        },
        20_000,
        'the replayed detection to be evaluated',
      );
      // Same verdict the live rule would reach...
      expect(row.alert_level).toBe('CRITICAL_PHOSPHORUS_FIRE');
      // ...marked as history...
      expect(row.backfilled).toBe(true);
      // ...and nothing went to a browser or a phone.
      expect(emitSpy).not.toHaveBeenCalledWith('alert:critical', expect.anything());
      expect(emitSpy).not.toHaveBeenCalledWith('anomaly:new', expect.anything());

      // The live picture does not list it, even though it is critical and
      // unacknowledged — it is not outstanding, it is 2019.
      const alerts = await request(app.getHttpServer())
        .get('/api/alerts?limit=100&sinceHours=1&criticalOnly=true&unacknowledgedOnly=true')
        .expect(200);
      expect(alerts.body.some((a: { acquiredAt: string }) => a.acquiredAt === HISTORIC_AT)).toBe(false);
    });

    it('reports what the rule made of the replayed passes', async () => {
      // "32 detections" says nothing on its own; "would have been critical"
      // is the answer the replay exists to give.
      //
      // Its own pass: the per-test TRUNCATE clears what the tests above left.
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_ARCHIVE_VERDICTS',
          satellite: 'TEST',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          acquiredAt: HISTORIC_AT,
          brightnessK: 345,
          frpMw: 9,
          confidence: 'h',
        },
        weather: { temperatureC: 34, soilMoisturePct: 9, observedAt: HISTORIC_AT },
        ingestion: 'backfill',
      });
      await waitFor(
        async () => {
          const { rows } = await db.query<{ n: string }>(
            `SELECT count(*) AS n FROM validated_events ve
               JOIN thermal_anomalies a ON a.id = ve.anomaly_id
              WHERE a.source = 'E2E_ARCHIVE_VERDICTS';`,
          );
          return Number(rows[0]!.n) > 0 ? true : undefined;
        },
        20_000,
        'the replayed pass to be evaluated',
      );

      const run = await request(app.getHttpServer())
        .post('/api/backfill/satellite')
        .set('X-API-Key', OPERATOR_KEY)
        .send({ from: HISTORIC_AT.slice(0, 10), to: HISTORIC_AT.slice(0, 10) })
        .expect(202);

      const list = await request(app.getHttpServer()).get('/api/backfill/satellite').expect(200);
      const mine = list.body.find((r: { id: number }) => r.id === run.body.id);
      expect(mine.verdicts).toEqual({ CRITICAL_PHOSPHORUS_FIRE: 1 });
    });

    it('lets the incident register see it — the reason the replay exists', async () => {
      // Its own replayed pass: the per-test TRUNCATE has already cleared the
      // one from the test above, and a distinct source keeps the queue's
      // idempotent job id from swallowing this as a duplicate.
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_ARCHIVE_REGISTER',
          satellite: 'TEST',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          acquiredAt: HISTORIC_AT,
          brightnessK: 345,
          frpMw: 9,
          confidence: 'h',
        },
        weather: { temperatureC: 34, soilMoisturePct: 9, observedAt: HISTORIC_AT },
        ingestion: 'backfill',
      });
      await waitFor(
        async () => {
          const { rows } = await db.query<{ n: string }>(
            `SELECT count(*) AS n FROM validated_events ve
               JOIN thermal_anomalies a ON a.id = ve.anomaly_id
              WHERE a.source = 'E2E_ARCHIVE_REGISTER';`,
          );
          return Number(rows[0]!.n) > 0 ? true : undefined;
        },
        20_000,
        'the replayed pass to be on record',
      );

      // A fire recorded at that spot, the afternoon of the pass.
      const created = await request(app.getHttpServer())
        .post('/api/incidents')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          occurredAt: '2019-07-25T15:00:00Z',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          kind: 'fire',
          title: 'E2E backfill fire 2019',
        })
        .expect(201);

      const res = await request(app.getHttpServer()).get('/api/incidents').expect(200);
      const incident = res.body.incidents.find((i: { id: number }) => i.id === created.body.id);
      // Judged by ACQUISITION time, so a verdict reached today about a pass
      // in 2019 still counts for the 2019 fire.
      expect(incident.satelliteSeen).toBe(true);
      expect(incident.alertRaised).toBe(true);
      expect(res.body.summary.firesSeen).toBeGreaterThanOrEqual(1);
    });
  });

  describe('a forest that is also contaminated', () => {
    let zoneId: number;

    beforeAll(async () => {
      // The Föhrenwald's real shape: a pine forest standing on WWII white
      // phosphorus. Both hazards, one zone.
      // Buffered on the geography type so 800 m means 800 metres, not degrees.
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO high_risk_zones (name, name_de, name_en, hazard_type, geom, is_active)
         VALUES ('e2e-both', 'Wald mit Altlast', 'Contaminated forest', 'white_phosphorus_forest',
                 ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 800)::geometry, TRUE)
         RETURNING id;`,
        [DRILL_LON, DRILL_LAT],
      );
      zoneId = Number(rows[0]!.id);
      // It must win over the seeded demo zone for the drill coordinate.
      await db.query(`UPDATE high_risk_zones SET is_active = FALSE WHERE id <> $1;`, [zoneId]);
    });

    afterAll(async () => {
      await db.query(`DELETE FROM high_risk_zones WHERE id = $1;`, [zoneId]);
      await db.query('UPDATE high_risk_zones SET is_active = TRUE;');
    });

    it('still escalates a credible detection on a cool, damp day', async () => {
      // The whole reason this profile exists: converting the zone to plain
      // white_phosphorus would have left this at ELEVATED — a real forest
      // fire in April paging nobody.
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_BOTH_COOL', satellite: 'TEST',
          latitude: DRILL_LAT, longitude: DRILL_LON,
          acquiredAt: new Date().toISOString(),
          brightnessK: 340, frpMw: 20, confidence: 'h',
        },
        weather: { temperatureC: 14, soilMoisturePct: 45, observedAt: new Date().toISOString() },
      });

      const level = await waitFor(
        async () => {
          const { rows } = await db.query<{ alert_level: string }>(
            `SELECT ve.alert_level FROM validated_events ve
               JOIN thermal_anomalies a ON a.id = ve.anomaly_id
              WHERE a.source = 'E2E_BOTH_COOL';`,
          );
          return rows[0]?.alert_level;
        },
        20_000,
        'the cool-day verdict',
      );
      expect(level).toBe('CRITICAL_WILDFIRE');
    });

    it('names the phosphorus mechanism once the window is open', async () => {
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_BOTH_HOT', satellite: 'TEST',
          latitude: DRILL_LAT, longitude: DRILL_LON,
          acquiredAt: new Date().toISOString(),
          // Low confidence on purpose: a self-ignition looks weak from orbit,
          // and an open window must stop the credibility gate from mattering.
          brightnessK: 320, frpMw: 2, confidence: 'l',
        },
        weather: { temperatureC: 34, soilMoisturePct: 8, observedAt: new Date().toISOString() },
      });

      const level = await waitFor(
        async () => {
          const { rows } = await db.query<{ alert_level: string }>(
            `SELECT ve.alert_level FROM validated_events ve
               JOIN thermal_anomalies a ON a.id = ve.anomaly_id
              WHERE a.source = 'E2E_BOTH_HOT';`,
          );
          return rows[0]?.alert_level;
        },
        20_000,
        'the open-window verdict',
      );
      expect(level).toBe('CRITICAL_PHOSPHORUS_FIRE');
    });

    it('reports the ignition window on the panel even though detection is the gate', async () => {
      await redis.set(
        'conditions:current',
        JSON.stringify({
          observedAt: new Date().toISOString(),
          cycleAt: new Date().toISOString(),
          temperatureC: 21.4,
          relativeHumidityPct: 40,
          soilMoisturePct: 11,
          stationId: '11090',
          area: '16,47,17,48',
        }),
      );

      const res = await request(app.getHttpServer()).get('/api/conditions').expect(200);
      const zone = res.body.zones.find((z: { id: number }) => z.id === zoneId);
      // Escalates on detection...
      expect(zone.gate).toBe('detection');
      expect(zone.armed).toBe(true);
      // ...and still measures the distance to the phosphorus window, which is
      // the number the ground sensors exist to improve.
      expect(zone.temperatureGapC).toBeCloseTo(8.6, 1);
      expect(zone.soilMoistureGapPct).toBeCloseTo(-9, 1);
    });
  });

  describe('fire danger (Canadian FWI)', () => {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      method: 'canadian_fwi',
      zones: [
        {
          zoneId: 1,
          name: { de: 'Zone', en: 'Zone' },
          hazardType: 'white_phosphorus',
          today: '2026-08-22',
          days: [
            { date: '2026-08-21', fwi: 18.2, dangerClass: 'moderate', ffmc: 88, dmc: 30, dc: 300, isi: 6, bui: 50 },
            { date: '2026-08-22', fwi: 24.6, dangerClass: 'high', ffmc: 90, dmc: 33, dc: 306, isi: 8, bui: 53 },
            { date: '2026-08-23', fwi: 39.1, dangerClass: 'very_high', ffmc: 91, dmc: 36, dc: 312, isi: 12, bui: 56 },
          ],
        },
      ],
    };

    afterEach(async () => {
      await redis.del('fire-danger:current');
    });

    it('is honestly unavailable until the workers have computed one', async () => {
      await redis.del('fire-danger:current');
      const res = await request(app.getHttpServer()).get('/api/fire-danger').expect(200);
      expect(res.body.available).toBe(false);
      expect(res.body.zones).toEqual([]);

      const conditions = await request(app.getHttpServer()).get('/api/conditions').expect(200);
      expect(conditions.body.fireDanger.available).toBe(false);
    });

    it('serves the snapshot and names the method on it', async () => {
      await redis.set('fire-danger:current', JSON.stringify(snapshot));
      const res = await request(app.getHttpServer()).get('/api/fire-danger').expect(200);
      expect(res.body.available).toBe(true);
      // Computed, not official — every consumer can see which.
      expect(res.body.method).toBe('canadian_fwi');
      expect(res.body.zones[0].days).toHaveLength(3);
    });

    it("folds today's figure and tomorrow's trend into the conditions", async () => {
      await redis.set('fire-danger:current', JSON.stringify(snapshot));
      const res = await request(app.getHttpServer()).get('/api/conditions').expect(200);
      expect(res.body.fireDanger).toMatchObject({
        available: true,
        method: 'canadian_fwi',
        fwi: 24.6,
        dangerClass: 'high',
        zoneId: 1,
        tomorrow: { fwi: 39.1, dangerClass: 'very_high' },
      });
      // ...and per zone, for the readiness list.
      const zone = res.body.zones.find((z: { id: number }) => z.id === 1);
      expect(zone.fireDanger).toEqual({ fwi: 24.6, dangerClass: 'high' });
    });

    it('is present even while the station readings are not', async () => {
      // Two feeds, two failure modes: a stopped ingestion cycle must not take
      // the fire danger down with it, and the panel can say so.
      await redis.del('conditions:current');
      await redis.set('fire-danger:current', JSON.stringify(snapshot));
      const res = await request(app.getHttpServer()).get('/api/conditions').expect(200);
      expect(res.body.available).toBe(false);
      expect(res.body.fireDanger.available).toBe(true);
    });
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

  describe('build identity', () => {
    it('reports the version from the manifest, not a hard-coded string', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);

      expect(res.body.status).toBe('ok');
      // The version is read relative to the compiled file's own location, so
      // this fails the moment the build layout moves package.json out of
      // reach — which would otherwise only surface as "unknown" on a server
      // after a deploy, exactly when the answer is needed.
      expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(res.body.version).toBe(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../package.json') as { version: string }).version,
      );
      expect(typeof res.body.revision).toBe('string');
    });
  });

  describe('situation report', () => {
    it('serves a dated, freshly generated PDF', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/report/lagebericht.pdf')
        .expect(200)
        .expect('Content-Type', /application\/pdf/);

      // A real PDF, not an HTML error page with a PDF header.
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      // A report with all sections cannot plausibly be tiny.
      expect(res.body.length).toBeGreaterThan(2_000);

      const today = new Date().toISOString().slice(0, 10);
      expect(res.headers['content-disposition']).toContain(
        `openfirewatch-lagebericht-${today}.pdf`,
      );
      // A cached situation report is a contradiction in terms.
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('speaks English on request and German on anything else', async () => {
      await request(app.getHttpServer())
        .get('/api/report/lagebericht.pdf?lang=en')
        .expect(200);
      // An unknown language must fall back, not fail: the report is the
      // document somebody needs in a hurry.
      await request(app.getHttpServer())
        .get('/api/report/lagebericht.pdf?lang=fr')
        .expect(200);
    });
  });

  describe('incident register and validation', () => {
    let phosphorusZoneId: number;

    beforeAll(async () => {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM high_risk_zones WHERE hazard_type = 'white_phosphorus' AND is_active LIMIT 1;`,
      );
      phosphorusZoneId = Number(rows[0]!.id);

      // Two hours of weather history at the incident dates: one with the
      // window open, one hot-but-damp. The validation must read the hour the
      // incident FELL IN, not the day.
      for (const [at, temp, soil] of [
        ['2019-08-01T12:00:00+02:00', 33, 9],
        ['2019-08-02T12:00:00+02:00', 33, 45],
      ] as const) {
        await db.query(
          `INSERT INTO zone_weather_history
             (zone_id, observed_at, temperature_c, soil_moisture_pct, source)
           VALUES ($1, $2, $3, $4, 'test')
           ON CONFLICT (zone_id, observed_at) DO NOTHING;`,
          [phosphorusZoneId, at, temp, soil],
        );
      }
    });

    afterAll(async () => {
      await db.query(`DELETE FROM incidents;`);
      await db.query(`DELETE FROM zone_weather_history WHERE source = 'test';`);
    });

    const record = (body: object) =>
      request(app.getHttpServer())
        .post('/api/incidents')
        .set('X-API-Key', OPERATOR_KEY)
        .send(body);

    it('keeps writes operator-only, reads public', async () => {
      await request(app.getHttpServer())
        .post('/api/incidents')
        .send({ occurredAt: '2019-08-01T12:30:00+02:00', latitude: DRILL_LAT,
                longitude: DRILL_LON, kind: 'fire', title: 'x' })
        .expect(401);
      await request(app.getHttpServer()).get('/api/incidents').expect(200);
    });

    it('validates a fire against the hour it fell in, not the day', async () => {
      // Inside the zone, during the OPEN hour.
      await record({
        occurredAt: '2019-08-01T12:30:00+02:00',
        latitude: DRILL_LAT, longitude: DRILL_LON,
        kind: 'fire', title: 'Brand im offenen Fenster',
      }).expect(201);
      // Inside the zone, during the hot-but-damp hour.
      await record({
        occurredAt: '2019-08-02T12:30:00+02:00',
        latitude: DRILL_LAT, longitude: DRILL_LON,
        kind: 'fire', title: 'Brand außerhalb des Fensters',
      }).expect(201);
      // Far outside every zone: the window question does not apply.
      await record({
        occurredAt: '2019-08-01T12:30:00+02:00',
        latitude: 47.0, longitude: 15.0,
        kind: 'fire', title: 'Brand ohne Zone',
      }).expect(201);

      const res = await request(app.getHttpServer()).get('/api/incidents').expect(200);
      const byTitle = (t: string) =>
        res.body.incidents.find((i: { title: string }) => i.title === t);

      expect(byTitle('Brand im offenen Fenster').inIgnitionWindow).toBe(true);
      expect(byTitle('Brand außerhalb des Fensters').inIgnitionWindow).toBe(false);
      // Null, not false: "we cannot say" must never read as "it was closed".
      expect(byTitle('Brand ohne Zone').inIgnitionWindow).toBeNull();
      expect(byTitle('Brand im offenen Fenster').zone.id).toBe(phosphorusZoneId);
    });

    it('links a fire to the alerts the system raised around it', async () => {
      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      await waitFor(
        async () => {
          const r = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&limit=1');
          return r.body.length > 0 ? true : undefined;
        },
        20_000,
        'critical alert for incident linking',
      );

      await record({
        occurredAt: new Date().toISOString(),
        latitude: DRILL_LAT, longitude: DRILL_LON,
        kind: 'fire', title: 'Brand mit Voralarm',
      }).expect(201);

      const res = await request(app.getHttpServer()).get('/api/incidents').expect(200);
      const linked = res.body.incidents.find(
        (i: { title: string }) => i.title === 'Brand mit Voralarm',
      );
      const old = res.body.incidents.find(
        (i: { title: string }) => i.title === 'Brand im offenen Fenster',
      );
      expect(linked.alertRaised).toBe(true);
      // 2019 lies far outside every alert's ±window.
      expect(old.alertRaised).toBe(false);
    });

    it('keeps drills out of the statistics', async () => {
      await record({
        occurredAt: '2019-08-01T12:30:00+02:00',
        latitude: DRILL_LAT, longitude: DRILL_LON,
        kind: 'drill', title: 'Übung',
      }).expect(201);

      const res = await request(app.getHttpServer()).get('/api/incidents').expect(200);
      // Four fires recorded across the tests above; the drill must not
      // become a fifth. Only the two 2019 fires have weather history for
      // their hour, so only they count as window-applicable.
      expect(res.body.summary.fires).toBe(4);
      expect(res.body.summary.firesWindowApplicable).toBe(2);
      expect(res.body.summary.firesInWindow).toBe(1);
    });

    it('records what the crew found, and counts it', async () => {
      // The event tables are truncated per test, so this test raises its own
      // alert rather than borrowing one from a neighbour.
      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      const alerts = await waitFor(
        async () => {
          const r = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&limit=1');
          return r.body.length > 0 ? r.body : undefined;
        },
        20_000,
        'critical alert for outcome recording',
      );
      const anomalyId = alerts[0].id;

      await request(app.getHttpServer())
        .post(`/api/alerts/${anomalyId}/outcome`)
        .send({ outcome: 'confirmed' })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/alerts/${anomalyId}/outcome`)
        .set('X-API-Key', OPERATOR_KEY)
        .send({ outcome: 'somewhere-in-between' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/alerts/${anomalyId}/outcome`)
        .set('X-API-Key', OPERATOR_KEY)
        .send({ outcome: 'nothing_found' })
        .expect(200);
      // A correction overwrites — outcomes state what turned out true.
      await request(app.getHttpServer())
        .post(`/api/alerts/${anomalyId}/outcome`)
        .set('X-API-Key', OPERATOR_KEY)
        .send({ outcome: 'confirmed' })
        .expect(200);

      const history = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true&limit=5')
        .expect(200);
      expect(
        history.body.find((e: { id: number }) => e.id === anomalyId).outcome,
      ).toBe('confirmed');

      const incidents = await request(app.getHttpServer()).get('/api/incidents').expect(200);
      expect(incidents.body.summary.alertsConfirmed).toBeGreaterThanOrEqual(1);
    });

    it('deletes an entry outright — corrected beats kept-wrong', async () => {
      const created = await record({
        occurredAt: '2020-01-01T12:00:00+01:00',
        latitude: DRILL_LAT, longitude: DRILL_LON,
        kind: 'observation', title: 'Irrtum',
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/incidents/${created.body.id}`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/api/incidents/${created.body.id}`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(404);
    });
  });

  describe('seasonal ignition history', () => {
    /** The seeded phosphorus zone — the only weather-gated one. */
    let phosphorusZoneId: number;

    beforeAll(async () => {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM high_risk_zones WHERE hazard_type = 'white_phosphorus' AND is_active LIMIT 1;`,
      );
      phosphorusZoneId = Number(rows[0]!.id);
    });

    /** Seed hourly weather as the backfill would. */
    async function seedHours(
      hours: { at: string; temperatureC: number; soilMoisturePct: number }[],
    ): Promise<void> {
      for (const hour of hours) {
        await db.query(
          `INSERT INTO zone_weather_history
             (zone_id, observed_at, temperature_c, soil_moisture_pct, source)
           VALUES ($1, $2, $3, $4, 'test')
           ON CONFLICT (zone_id, observed_at) DO NOTHING;`,
          [phosphorusZoneId, hour.at, hour.temperatureC, hour.soilMoisturePct],
        );
      }
    }

    beforeEach(async () => {
      await db.query(`DELETE FROM zone_weather_history;`);
    });

    afterAll(async () => {
      await db.query(`DELETE FROM zone_weather_history;`);
    });

    /** `any` on purpose: this asserts the API's JSON shape, so typing it here
     *  would only restate the thing under test. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zoneOf = (body: any) =>
      body.zones.find((z: any) => z.zoneId === phosphorusZoneId);

    it('counts a day only where both criteria meet in the same hour', async () => {
      await seedHours([
        // Hot but damp, then dry but cool, on the same day: no ignition hour.
        { at: '2021-07-01T13:00+02:00', temperatureC: 35, soilMoisturePct: 40 },
        { at: '2021-07-01T04:00+02:00', temperatureC: 10, soilMoisturePct: 5 },
        // A day where they genuinely coincide.
        { at: '2021-07-05T14:00+02:00', temperatureC: 31, soilMoisturePct: 12 },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/history/ignition-windows')
        .expect(200);
      const zone = zoneOf(res.body);

      expect(zone.years).toHaveLength(1);
      expect(zone.years[0]).toEqual(
        expect.objectContaining({ year: 2021, days: 1, hours: 1 }),
      );
    });

    it('groups days by year and month, and keeps the longest single spell', async () => {
      await seedHours([
        // A three-hour spell on one July day.
        { at: '2022-07-10T12:00+02:00', temperatureC: 32, soilMoisturePct: 10 },
        { at: '2022-07-10T13:00+02:00', temperatureC: 34, soilMoisturePct: 9 },
        { at: '2022-07-10T14:00+02:00', temperatureC: 33, soilMoisturePct: 9 },
        // A single hour in August.
        { at: '2022-08-02T15:00+02:00', temperatureC: 31, soilMoisturePct: 11 },
        // Another year entirely.
        { at: '2023-06-20T15:00+02:00', temperatureC: 31, soilMoisturePct: 11 },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/history/ignition-windows')
        .expect(200);
      const zone = zoneOf(res.body);

      expect(zone.years.map((y: { year: number }) => y.year)).toEqual([2022, 2023]);
      const y22 = zone.years[0];
      expect(y22).toEqual(
        expect.objectContaining({ days: 2, hours: 4, longestWindowHours: 3 }),
      );
      expect(y22.months).toEqual([
        { month: 7, days: 1, hours: 3 },
        { month: 8, days: 1, hours: 1 },
      ]);
    });

    it('leaves the running year out of the average', async () => {
      const thisYear = new Date().getFullYear();
      await seedHours([
        { at: `2020-07-01T14:00+02:00`, temperatureC: 32, soilMoisturePct: 10 },
        { at: `2021-07-01T14:00+02:00`, temperatureC: 32, soilMoisturePct: 10 },
        { at: `2021-07-02T14:00+02:00`, temperatureC: 32, soilMoisturePct: 10 },
        { at: `2021-07-03T14:00+02:00`, temperatureC: 32, soilMoisturePct: 10 },
        // Half a season in the current year would drag the mean down and read
        // as a trend rather than as the calendar not being finished.
        { at: `${thisYear}-07-01T14:00+02:00`, temperatureC: 32, soilMoisturePct: 10 },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/history/ignition-windows')
        .expect(200);
      const zone = zoneOf(res.body);

      // (1 day in 2020 + 3 days in 2021) / 2 complete years = 2.0
      expect(zone.averageDaysPerYear).toBe(2);
      expect(zone.years.some((y: { year: number }) => y.year === thisYear)).toBe(true);
    });

    it('applies the same thresholds as the live rule, at their exact edges', async () => {
      await seedHours([
        { at: '2019-07-01T14:00+02:00', temperatureC: 30, soilMoisturePct: 19.9 },
        { at: '2019-07-02T14:00+02:00', temperatureC: 29.9, soilMoisturePct: 19.9 },
        { at: '2019-07-03T14:00+02:00', temperatureC: 30, soilMoisturePct: 20 },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/history/ignition-windows')
        .expect(200);

      // Only the first hour qualifies: >= 30 °C and strictly below 20 %.
      expect(zoneOf(res.body).years[0].days).toBe(1);
    });

    it('reports no history for zones whose escalation ignores weather', async () => {
      // The seeded database holds only the phosphorus zone, so this test
      // brings its own wildfire zone rather than assuming one exists.
      await request(app.getHttpServer())
        .post('/api/risk-zones')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          nameDe: 'e2e-zone Saison Waldbrand',
          nameEn: 'e2e-zone season wildfire',
          hazardType: 'wildfire',
          geometry: {
            type: 'Polygon',
            coordinates: [[[16.3, 47.7], [16.31, 47.7], [16.31, 47.71], [16.3, 47.71], [16.3, 47.7]]],
          },
        })
        .expect(201);

      try {
        const res = await request(app.getHttpServer())
          .get('/api/history/ignition-windows')
          .expect(200);

        const wildfire = res.body.zones.find(
          (z: { hazardType: string }) => z.hazardType === 'wildfire',
        );
        // Reporting "0 ignition days" for a zone that escalates on any
        // detection would read as a decade of safety it never had.
        expect(wildfire.weatherGated).toBe(false);
        expect(wildfire.years).toEqual([]);
        expect(wildfire.averageDaysPerYear).toBeNull();
      } finally {
        await db.query(`DELETE FROM high_risk_zones WHERE name_de LIKE 'e2e-zone Saison%';`);
      }
    });

    it('exports the record as CSV a German-locale spreadsheet can open', async () => {
      await seedHours([
        { at: '2022-07-10T13:00+02:00', temperatureC: 32, soilMoisturePct: 10 },
        { at: '2022-07-10T14:00+02:00', temperatureC: 33, soilMoisturePct: 9 },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/history/ignition-windows.csv')
        .expect(200)
        .expect('Content-Type', /text\/csv/);

      // BOM first, so Excel decodes umlauts in zone names; semicolons,
      // because a German locale treats the comma as a decimal sign.
      expect(res.text.startsWith('\ufeff')).toBe(true);
      const lines = res.text.replace('\ufeff', '').trim().split('\r\n');
      expect(lines[0]).toBe('zone_id;zone;datum;stunden_im_fenster');
      expect(lines.some((l) => l.endsWith(';2022-07-10;2'))).toBe(true);
    });

    it('names the data source rather than hiding the soil-layer difference', async () => {
      await seedHours([
        { at: '2018-07-01T14:00+02:00', temperatureC: 32, soilMoisturePct: 10 },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/history/ignition-windows')
        .expect(200);
      expect(zoneOf(res.body).sources).toContain('test');
    });
  });

  describe('ignition-window forecast', () => {
    /** Publish a forecast as the workers would, so the API can be asked. */
    async function publishForecast(
      hours: { at: string; temperatureC: number; soilMoisturePct: number }[],
      hazardType = 'white_phosphorus',
    ): Promise<void> {
      await redis.set(
        'forecast:current',
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          zones: [
            {
              zoneId: 1,
              name: { de: 'Testzone', en: 'Test zone' },
              hazardType,
              hours,
            },
          ],
        }),
        'EX',
        300,
      );
    }

    /**
     * `n` hours from now, in the shape the workers publish: local wall clock
     * with its UTC offset. Writing these without the offset is what exposed
     * the real bug — an unqualified timestamp is read in the server's own
     * zone, which silently shifted every window inside a UTC container.
     */
    const hourAt = (offset: number): string =>
      new Date(Date.now() + offset * 3_600_000).toISOString().slice(0, 16) + '+00:00';

    afterEach(async () => {
      await redis.del('forecast:current');
    });

    it('says the outlook is unknown rather than implying safety', async () => {
      await redis.del('forecast:current');
      const res = await request(app.getHttpServer()).get('/api/forecast').expect(200);

      // An empty zone list would read as "no ignition window ahead", which is
      // the opposite of what a missing forecast means.
      expect(res.body.available).toBe(false);
      expect(res.body.zones).toEqual([]);
    });

    it('finds a window only where BOTH criteria hold in the same hour', async () => {
      // Hot but damp, then dry but cool: a daily max/min comparison would
      // report a window here that never existed.
      await publishForecast([
        { at: hourAt(1), temperatureC: 34, soilMoisturePct: 40 },
        { at: hourAt(2), temperatureC: 12, soilMoisturePct: 5 },
      ]);

      const res = await request(app.getHttpServer()).get('/api/forecast').expect(200);
      expect(res.body.zones[0].windows).toEqual([]);
      expect(res.body.zones[0].hoursUntilNextWindow).toBeNull();
    });

    it('groups consecutive qualifying hours into one window with its peaks', async () => {
      await publishForecast([
        { at: hourAt(1), temperatureC: 20, soilMoisturePct: 8 },
        { at: hourAt(2), temperatureC: 31, soilMoisturePct: 9 },
        { at: hourAt(3), temperatureC: 34, soilMoisturePct: 7 },
        { at: hourAt(4), temperatureC: 30, soilMoisturePct: 6 },
        { at: hourAt(5), temperatureC: 22, soilMoisturePct: 6 },
        // A separate spell later on must not merge with the first.
        { at: hourAt(30), temperatureC: 33, soilMoisturePct: 9 },
      ]);

      const res = await request(app.getHttpServer()).get('/api/forecast').expect(200);
      const zone = res.body.zones[0];

      expect(zone.windows).toHaveLength(2);
      expect(zone.windows[0]).toEqual(
        expect.objectContaining({ peakTemperatureC: 34, minSoilMoisturePct: 6 }),
      );
      expect(zone.hoursUntilNextWindow).toBeGreaterThanOrEqual(1);
      expect(zone.hoursUntilNextWindow).toBeLessThanOrEqual(3);
    });

    it('refuses to forecast a zone whose escalation does not depend on weather', async () => {
      // Conditions that would be a window for phosphorus.
      await publishForecast(
        [{ at: hourAt(1), temperatureC: 35, soilMoisturePct: 5 }],
        'wildfire',
      );

      const res = await request(app.getHttpServer()).get('/api/forecast').expect(200);
      const zone = res.body.zones[0];

      // Saying "no ignition window" about a wildfire zone would read as
      // reassurance the system has no basis for.
      expect(zone.weatherGated).toBe(false);
      expect(zone.windows).toEqual([]);
    });

    it('uses the same thresholds as the live rule, not its own copy', async () => {
      // Exactly on the temperature threshold and just under the soil one:
      // qualifies. A forecast that disagreed with the evaluator here would
      // be the drift the shared constants exist to prevent.
      await publishForecast([
        { at: hourAt(1), temperatureC: 30, soilMoisturePct: 19.9 },
        { at: hourAt(6), temperatureC: 29.9, soilMoisturePct: 19.9 },
        { at: hourAt(8), temperatureC: 30, soilMoisturePct: 20 },
      ]);

      const res = await request(app.getHttpServer()).get('/api/forecast').expect(200);
      const windows = res.body.zones[0].windows;
      expect(windows).toHaveLength(1);
      expect(windows[0].peakTemperatureC).toBe(30);
    });
  });

  describe('notifications', () => {
    /**
     * A local HTTP server standing in for whatever the operator points the
     * webhook at. Using the real channel against a real socket exercises the
     * signature, the timeout and the JSON body — a mocked channel would
     * assert only that the dispatcher calls a function.
     */
    let received: { headers: Record<string, string>; body: any }[] = [];
    let hookServer: import('node:http').Server;
    let hookUrl: string;

    beforeAll(async () => {
      const http = await import('node:http');
      hookServer = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          received.push({
            headers: req.headers as Record<string, string>,
            body: JSON.parse(raw || '{}'),
          });
          res.writeHead(204).end();
        });
      });
      await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
      const address = hookServer.address() as import('node:net').AddressInfo;
      hookUrl = `http://127.0.0.1:${address.port}/hook`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => hookServer.close(() => resolve()));
    });

    beforeEach(() => {
      received = [];
      configureNotifications({
        webhookUrl: undefined,
        webhookSecret: undefined,
        language: 'de',
      });
    });


    /**
     * Point the notification channels somewhere, the way a deployment would.
     *
     * These used to assign `process.env` mid-test, which worked only because
     * every channel re-read the environment on every call. Configuration is
     * now parsed once at boot — correct, because an environment variable
     * cannot change inside a running process — so a test that wants a
     * different setting has to change the object the application holds.
     */
    const configureNotifications = (
      overrides: Partial<AppConfig['notifications']>,
    ): void => {
      Object.assign(app.get<AppConfig>(APP_CONFIG).notifications, overrides);
    };
    /** Give the dispatcher a moment: delivery is deliberately off the
     *  request path, so the response returns before the POST lands. */
    const settle = () => new Promise((r) => setTimeout(r, 400));

    it('reports which channels exist, and that none is configured by default', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications/channels')
        .expect(200);

      const names = res.body.map((c: { name: string }) => c.name).sort();
      expect(names).toEqual(['telegram', 'webhook']);
      // Nothing configured → nothing is delivered anywhere. A deployment that
      // never set this up must not be told it has notifications.
      expect(res.body.every((c: { configured: boolean }) => !c.configured)).toBe(true);
    });

    it('refuses to let a stranger send messages to the crew', async () => {
      await request(app.getHttpServer()).post('/api/notifications/test').expect(401);
      await request(app.getHttpServer())
        .post('/api/notifications/test')
        .set('X-API-Key', 'wrong-key')
        .expect(401);
    });

    it('delivers to a configured webhook, signed', async () => {
      configureNotifications({ webhookUrl: hookUrl, webhookSecret: 'e2e-secret' });

      const res = await request(app.getHttpServer())
        .post('/api/notifications/test')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      expect(res.body.dispatchedTo).toContain('webhook');

      await settle();
      expect(received).toHaveLength(1);
      expect(received[0]!.body).toEqual(
        expect.objectContaining({ source: 'openfirewatch', kind: 'test' }),
      );

      // The signature must cover the exact bytes sent, or a receiver that
      // verifies it would reject every genuine notification.
      const { createHmac } = await import('node:crypto');
      const expected =
        'sha256=' +
        createHmac('sha256', 'e2e-secret')
          .update(JSON.stringify(received[0]!.body))
          .digest('hex');
      expect(received[0]!.headers['x-openfirewatch-signature']).toBe(expected);
    });

    it('omits the signature when no secret is set, rather than sending a fake one', async () => {
      configureNotifications({ webhookUrl: hookUrl });

      await request(app.getHttpServer())
        .post('/api/notifications/test')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);

      await settle();
      expect(received).toHaveLength(1);
      expect(received[0]!.headers['x-openfirewatch-signature']).toBeUndefined();
    });

    it('relays a real critical alert, and only once', async () => {
      configureNotifications({ webhookUrl: hookUrl });

      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);

      const alert = await waitFor(
        async () => (received.length > 0 ? received[0] : undefined),
        20_000,
        'notification for a critical alert',
      );
      expect(alert.body.kind).toBe('alert.critical');
      expect(alert.body.severity).toBe('critical');
      expect(alert.body.title).toContain('Phosphorbrand');
      // The body is read by a person on a phone, so it carries the numbers
      // rather than only a machine payload.
      expect(alert.body.body).toContain('32');
      expect(alert.body.data.id).toBeDefined();

      // Re-publishing the same anomaly must not send a second message: the
      // dedupe key is the anomaly, not the delivery attempt.
      const anomalyId = alert.body.data.id;
      const before = received.length;
      const publisher = new IORedis({ host: '127.0.0.1', port: 6379, db: 15 });
      await publisher.publish(
        'alerts:anomalies',
        JSON.stringify({ ...alert.body.data, id: anomalyId }),
      );
      await settle();
      await publisher.quit();
      expect(received.length).toBe(before);
    });

    it('records every delivery, so "was anyone told?" has an answer', async () => {
      configureNotifications({ webhookUrl: hookUrl });
      await request(app.getHttpServer())
        .post('/api/notifications/test')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      await settle();

      const { rows } = await db.query(
        `SELECT channel, status FROM notification_deliveries
          WHERE kind = 'test' ORDER BY created_at DESC LIMIT 1;`,
      );
      expect(rows[0]).toEqual({ channel: 'webhook', status: 'sent' });
    });

    it('speaks the configured language', async () => {
      configureNotifications({ webhookUrl: hookUrl, language: 'en' });
      try {
        await request(app.getHttpServer())
          .post('/api/notifications/test')
          .set('X-API-Key', OPERATOR_KEY)
          .expect(202);
        await settle();
        expect(received[0]!.body.title).toBe('OpenFireWatch — test message');

        // And the default stays German — the deployment this was built for.
        configureNotifications({ language: 'de' });
        received.length = 0;
        await request(app.getHttpServer())
          .post('/api/notifications/test')
          .set('X-API-Key', OPERATOR_KEY)
          .expect(202);
        await settle();
        expect(received[0]!.body.title).toBe('OpenFireWatch — Testmeldung');
      } finally {
        configureNotifications({ language: 'de' });
      }
    });

    it('reminds about an alert nobody has taken — once', async () => {
      configureNotifications({ webhookUrl: hookUrl });
      const { EscalationService } = await import('../src/notifications/escalation.service');
      const escalation = app.get(EscalationService);

      // Raise a real critical alert...
      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      const alerts = await waitFor(
        async () => {
          const r = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&unacknowledgedOnly=true&limit=1');
          return r.body.length > 0 ? r.body : undefined;
        },
        20_000,
        'critical alert for escalation',
      );
      const anomalyId = alerts[0].id;
      received.length = 0; // drop the alert notification itself

      // Fresh alert, no delay elapsed: a sweep must stay silent.
      await escalation.sweep();
      await settle();
      expect(received).toHaveLength(0);

      // Age it past the delay, as time would.
      await db.query(
        `UPDATE validated_events SET evaluated_at = now() - interval '30 minutes'
          WHERE anomaly_id = $1;`,
        [anomalyId],
      );
      await escalation.sweep();
      await settle();
      expect(received).toHaveLength(1);
      expect(received[0]!.body.kind).toBe('alert.unacknowledged');
      expect(received[0]!.body.body).toContain(String(anomalyId));

      // A second sweep must NOT repeat it — that is how channels get muted.
      await escalation.sweep();
      await settle();
      expect(received).toHaveLength(1);
    });

    it('never reminds about an alert somebody has taken', async () => {
      configureNotifications({ webhookUrl: hookUrl });
      const { EscalationService } = await import('../src/notifications/escalation.service');
      const escalation = app.get(EscalationService);

      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      const alerts = await waitFor(
        async () => {
          const r = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&unacknowledgedOnly=true&limit=1');
          return r.body.length > 0 ? r.body : undefined;
        },
        20_000,
        'critical alert for ack-then-escalate',
      );
      const anomalyId = alerts[0].id;

      await request(app.getHttpServer())
        .post(`/api/alerts/${anomalyId}/acknowledge`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(200);
      await db.query(
        `UPDATE validated_events SET evaluated_at = now() - interval '30 minutes'
          WHERE anomaly_id = $1;`,
        [anomalyId],
      );
      received.length = 0;

      await escalation.sweep();
      await settle();
      // The whole point of acknowledgement: taken means no further noise.
      expect(received).toHaveLength(0);
    });

    it('records a failure instead of losing it', async () => {
      // A port nothing listens on: the channel throws, the dispatcher retries,
      // and the outcome still has to end up on the record.
      configureNotifications({ webhookUrl: 'http://127.0.0.1:1/nowhere' });

      await request(app.getHttpServer())
        .post('/api/notifications/test')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);
      // Two retries with backoff before it gives up.
      await new Promise((r) => setTimeout(r, 8_000));

      const { rows } = await db.query(
        `SELECT status, error FROM notification_deliveries
          WHERE kind = 'test' ORDER BY created_at DESC LIMIT 1;`,
      );
      expect(rows[0].status).toBe('failed');
      expect(rows[0].error).toBeTruthy();
    }, 20_000);
  });

  describe('acknowledgement', () => {
    /** Raise a real critical alert and return the anomaly id it produced. */
    async function raiseCriticalAlert(): Promise<number> {
      await request(app.getHttpServer())
        .post('/api/simulate-fire')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(202);

      const outstanding = await waitFor(
        async () => {
          const res = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&unacknowledgedOnly=true&limit=10')
            .expect(200);
          return res.body.length > 0 ? res.body : undefined;
        },
        20_000,
        'outstanding critical alert',
      );
      return outstanding[0].id as number;
    }

    it('refuses to let a passer-by silence an alarm', async () => {
      const id = await raiseCriticalAlert();

      await request(app.getHttpServer())
        .post(`/api/alerts/${id}/acknowledge`)
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/alerts/${id}/acknowledge`)
        .set('X-API-Key', 'wrong-key')
        .expect(401);

      // Still outstanding: a rejected acknowledgement must change nothing.
      const res = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true&unacknowledgedOnly=true&limit=10')
        .expect(200);
      expect(res.body.map((e: { id: number }) => e.id)).toContain(id);
    });

    it('records the acknowledgement and drops the alert from what is outstanding', async () => {
      const id = await raiseCriticalAlert();

      const ack = await request(app.getHttpServer())
        .post(`/api/alerts/${id}/acknowledge`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(200);
      expect(Date.parse(ack.body.acknowledgedAt)).not.toBeNaN();

      const outstanding = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true&unacknowledgedOnly=true&limit=10')
        .expect(200);
      expect(outstanding.body.map((e: { id: number }) => e.id)).not.toContain(id);

      // The record keeps it: acknowledging is not deleting.
      const history = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true&limit=10')
        .expect(200);
      const entry = history.body.find((e: { id: number }) => e.id === id);
      expect(entry.acknowledgedAt).toBe(ack.body.acknowledgedAt);
    });

    it('is idempotent, so two responders pressing at once is not an error', async () => {
      const id = await raiseCriticalAlert();

      const first = await request(app.getHttpServer())
        .post(`/api/alerts/${id}/acknowledge`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/api/alerts/${id}/acknowledge`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(200);

      // The second press must not rewrite when the alert was taken.
      expect(second.body.acknowledgedAt).toBe(first.body.acknowledgedAt);
    });

    it('reports an unknown alert instead of silently succeeding', async () => {
      await request(app.getHttpServer())
        .post('/api/alerts/999999999/acknowledge')
        .set('X-API-Key', OPERATOR_KEY)
        .expect(404);
    });
  });

  describe('ground sensors', () => {
    const SENSOR_TOKEN = process.env.SENSOR_INGEST_TOKEN!;

    /** Register a sensor at the drill point (inside the phosphorus zone). */
    async function registerSensor(
      deviceId: string,
      calibration: { scale?: number; offsetPct?: number; tempOffsetC?: number } = {},
    ): Promise<void> {
      await db.query(
        `INSERT INTO ground_sensors
           (device_id, label, geom, soil_moisture_scale, soil_moisture_offset_pct, temperature_offset_c)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7)
         ON CONFLICT (device_id) DO UPDATE
           SET soil_moisture_scale = EXCLUDED.soil_moisture_scale,
               soil_moisture_offset_pct = EXCLUDED.soil_moisture_offset_pct,
               temperature_offset_c = EXCLUDED.temperature_offset_c,
               is_active = TRUE;`,
        [
          deviceId,
          `e2e ${deviceId}`,
          DRILL_LON,
          DRILL_LAT,
          calibration.scale ?? 1,
          calibration.offsetPct ?? 0,
          calibration.tempOffsetC ?? 0,
        ],
      );
    }

    afterEach(async () => {
      // Sensors sit outside the per-test TRUNCATE, so clean up explicitly —
      // a leftover live sensor would silently change every later verdict.
      await db.query(
        `DELETE FROM sensor_readings WHERE sensor_id IN
           (SELECT id FROM ground_sensors WHERE device_id LIKE 'e2e-%');`,
      );
      await db.query(`DELETE FROM ground_sensors WHERE device_id LIKE 'e2e-%';`);
    });

    it('refuses readings without the gateway token, and from unknown devices', async () => {
      const reading = {
        deviceId: 'e2e-nobody',
        observedAt: new Date().toISOString(),
        temperatureC: 20,
      };

      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .send(reading)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', 'wrong-token')
        .send(reading)
        .expect(401);

      // Right token, unregistered device: reported, never auto-created — a
      // reading with no registered position has no zone to apply to.
      const res = await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send(reading)
        .expect(202);
      expect(res.body).toEqual({ accepted: 0, unknownDevices: ['e2e-nobody'] });
    });

    it('applies the field calibration on read, not on write', async () => {
      // A capacitive probe reporting roughly half the true value.
      await registerSensor('e2e-cal', { scale: 2, offsetPct: 1 });

      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send({
          deviceId: 'e2e-cal',
          observedAt: new Date().toISOString(),
          temperatureC: 20,
          soilMoisturePct: 12, // raw
        })
        .expect(202);

      const res = await request(app.getHttpServer()).get('/api/sensors').expect(200);
      const sensor = res.body.find(
        (s: { deviceId: string }) => s.deviceId === 'e2e-cal',
      );
      expect(sensor.reporting).toBe(true);
      expect(sensor.soilMoisturePct).toBe(25); // 12 * 2 + 1
      // The raw value stays raw in storage, so a corrected calibration also
      // corrects the past.
      const { rows } = await db.query(
        `SELECT soil_moisture_pct_raw FROM sensor_readings
          WHERE sensor_id = (SELECT id FROM ground_sensors WHERE device_id = 'e2e-cal');`,
      );
      expect(Number(rows[0].soil_moisture_pct_raw)).toBe(12);
    });

    it('lets measured ground truth escalate what the regional estimate would hold back', async () => {
      await registerSensor('e2e-ground');

      // The wood itself: hot and bone dry.
      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send({
          deviceId: 'e2e-ground',
          observedAt: new Date().toISOString(),
          temperatureC: 33,
          soilMoisturePct: 12,
        })
        .expect(202);

      // The regional estimate: a cool, damp day that would gate phosphorus
      // at ELEVATED. The sensor inside the zone must outrank it.
      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_SENSOR',
          satellite: 'TEST',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          acquiredAt: new Date().toISOString(),
          brightnessK: 340,
          frpMw: 12,
          confidence: 'h',
        },
        weather: {
          temperatureC: 18,
          soilMoisturePct: 45,
          windSpeedKmh: 5,
          observedAt: new Date().toISOString(),
        },
      });

      const rows = await waitFor(
        async () => {
          const { rows } = await db.query(
            `SELECT alert_level, temperature_c, soil_moisture_pct FROM validated_events;`,
          );
          return rows.length > 0 ? rows : undefined;
        },
        20_000,
        'sensor-driven verdict',
      );
      expect(rows[0].alert_level).toBe('CRITICAL_PHOSPHORUS_FIRE');
      // The record carries the numbers the rule actually ran on — the
      // measured ones, not the regional estimate it overrode.
      expect(Number(rows[0].temperature_c)).toBe(33);
      expect(Number(rows[0].soil_moisture_pct)).toBe(12);
    });

    it('falls back to the regional estimate once the sensor goes stale', async () => {
      await registerSensor('e2e-stale');

      // Alarming values — but hours old. A dead sensor must not keep
      // reporting on behalf of the wood, in either direction.
      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send({
          deviceId: 'e2e-stale',
          observedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
          temperatureC: 40,
          soilMoisturePct: 5,
        })
        .expect(202);

      await reportsQueue.add('detection-report', {
        detection: {
          source: 'E2E_SENSOR',
          satellite: 'TEST',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          acquiredAt: new Date().toISOString(),
          brightnessK: 340,
          frpMw: 12,
          confidence: 'h',
        },
        weather: {
          temperatureC: 18,
          soilMoisturePct: 45,
          windSpeedKmh: 5,
          observedAt: new Date().toISOString(),
        },
      });

      const rows = await waitFor(
        async () => {
          const { rows } = await db.query(`SELECT alert_level FROM validated_events;`);
          return rows.length > 0 ? rows : undefined;
        },
        20_000,
        'stale-sensor verdict',
      );
      expect(rows[0].alert_level).toBe('ELEVATED');

      // And the status endpoint says so, which is what a maintenance round
      // would read.
      const res = await request(app.getHttpServer()).get('/api/sensors').expect(200);
      const sensor = res.body.find(
        (s: { deviceId: string }) => s.deviceId === 'e2e-stale',
      );
      expect(sensor.reporting).toBe(false);
    });

    it('accepts a LoRaWAN uplink envelope straight from a network server webhook', async () => {
      await registerSensor('e2e-lora');

      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('Authorization', `Bearer ${SENSOR_TOKEN}`)
        .send({
          end_device_ids: { device_id: 'e2e-lora' },
          received_at: new Date().toISOString(),
          uplink_message: {
            received_at: new Date().toISOString(),
            decoded_payload: { temperatureC: 21.5, soilMoisturePct: 30, batteryPct: 87 },
          },
        })
        .expect(202)
        .expect((res) => {
          expect(res.body.accepted).toBe(1);
        });

      const res = await request(app.getHttpServer()).get('/api/sensors').expect(200);
      const sensor = res.body.find(
        (s: { deviceId: string }) => s.deviceId === 'e2e-lora',
      );
      expect(sensor.temperatureC).toBe(21.5);
      expect(sensor.batteryPct).toBe(87);
      expect(sensor.zoneId).not.toBeNull(); // derived from where it stands
    });

    it('is managed with the operator key, and the zone follows the position', async () => {
      const body = {
        deviceId: 'e2e-managed',
        label: 'e2e managed probe',
        latitude: DRILL_LAT,
        longitude: DRILL_LON,
        soilMoistureScale: 1.5,
      };

      // Registry writes are operator work, not gateway work: the gateway
      // token must not be able to move a sensor.
      await request(app.getHttpServer()).post('/api/sensors').send(body).expect(401);
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send(body)
        .expect(401);

      const created = await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send(body)
        .expect(201);
      const id = created.body.id as number;

      // Inside the phosphorus zone → zone derived from the coordinates.
      let list = await request(app.getHttpServer()).get('/api/sensors').expect(200);
      let sensor = list.body.find((s: { id: number }) => s.id === id);
      expect(sensor.zoneId).not.toBeNull();
      expect(sensor.label).toBe('e2e managed probe');

      // A second live sensor may not claim the same device id.
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send(body)
        .expect(409);

      // Moving it far outside every zone clears the derived zone.
      await request(app.getHttpServer())
        .put(`/api/sensors/${id}`)
        .set('X-API-Key', OPERATOR_KEY)
        .send({ ...body, latitude: 47.0, longitude: 15.0 })
        .expect(204);
      list = await request(app.getHttpServer()).get('/api/sensors').expect(200);
      sensor = list.body.find((s: { id: number }) => s.id === id);
      expect(sensor.zoneId).toBeNull();

      // Retire hides it from the registry without deleting anything...
      await request(app.getHttpServer())
        .delete(`/api/sensors/${id}`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(204);
      list = await request(app.getHttpServer()).get('/api/sensors').expect(200);
      expect(list.body.some((s: { id: number }) => s.id === id)).toBe(false);

      // ...and registering the same device id again re-activates it: the
      // natural meaning of typing a decommissioned probe's id is that it has
      // been remounted, and its old readings stay attached.
      const revived = await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send(body)
        .expect(201);
      expect(revived.body.id).toBe(id);
    });

    it('rejects a calibration that is almost certainly a typo', async () => {
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          deviceId: 'e2e-typo',
          label: 'typo probe',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          soilMoistureScale: 50, // no probe is off by 50×
        })
        .expect(400);
    });

    it('raises a real alert when a probe measures fire-grade heat', async () => {
      // A probe in the phosphorus zone, with a calibration that matters: the
      // trigger must fire on the CALIBRATED value, or an offset probe would
      // silently alert at the wrong temperature.
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          deviceId: 'e2e-alert-probe',
          label: 'e2e Alarmsonde',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
          temperatureOffsetC: 10,
        })
        .expect(201);

      // Raw 45 + offset 10 = 55 °C calibrated — past the 50 °C absolute line.
      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send({
          deviceId: 'e2e-alert-probe',
          observedAt: new Date().toISOString(),
          temperatureC: 45,
          soilMoisturePct: 12,
        })
        .expect(202);

      const alerts = await waitFor(
        async () => {
          const r = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&unacknowledgedOnly=true&limit=5');
          const hit = r.body.find(
            (e: { level: string }) => e.level === 'CRITICAL_SENSOR_HEAT',
          );
          return hit ?? undefined;
        },
        20_000,
        'sensor-heat alert',
      );

      // An ordinary alert in every way that matters downstream.
      expect(alerts.weather.temperatureC).toBe(55);
      expect(alerts.zone).not.toBeNull();
      await request(app.getHttpServer())
        .post(`/api/alerts/${alerts.id}/acknowledge`)
        .set('X-API-Key', OPERATOR_KEY)
        .expect(200);
    });

    it('does not alert twice for the same episode', async () => {
      // Self-contained: the suite deletes sensors after every test, so this
      // one registers its own probe and sends both readings itself.
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          deviceId: 'e2e-cooldown-probe',
          label: 'e2e Cooldownsonde',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
        })
        .expect(201);

      for (const [offsetMs, temp] of [[0, 56], [60_000, 54]] as const) {
        await request(app.getHttpServer())
          .post('/api/sensors/readings')
          .set('X-Sensor-Token', SENSOR_TOKEN)
          .send({
            deviceId: 'e2e-cooldown-probe',
            observedAt: new Date(Date.now() + offsetMs).toISOString(),
            temperatureC: temp,
          })
          .expect(202);
        await new Promise((r) => setTimeout(r, 400));
      }

      const res = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true&limit=10')
        .expect(200);
      const sensorAlerts = res.body.filter(
        (e: { level: string }) => e.level === 'CRITICAL_SENSOR_HEAT',
      );
      // Both readings are fire-grade; the second is the same fire.
      expect(sensorAlerts).toHaveLength(1);
    });

    it('flags an abnormal CLIMB long before any absolute line', async () => {
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          deviceId: 'e2e-climb-probe',
          label: 'e2e Anstiegssonde',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
        })
        .expect(201);

      // A believable evening: ~20 °C for hours, then a jump to 38 — sixteen
      // degrees above the baseline median, nowhere near 50.
      const base = Date.now() - 5 * 3_600_000;
      for (const [offsetH, temp] of [[0, 20], [1, 20.4], [2, 19.8], [3, 20.1]] as const) {
        await request(app.getHttpServer())
          .post('/api/sensors/readings')
          .set('X-Sensor-Token', SENSOR_TOKEN)
          .send({
            deviceId: 'e2e-climb-probe',
            observedAt: new Date(base + offsetH * 3_600_000).toISOString(),
            temperatureC: temp,
          })
          .expect(202);
      }
      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send({
          deviceId: 'e2e-climb-probe',
          observedAt: new Date().toISOString(),
          temperatureC: 38,
        })
        .expect(202);

      await waitFor(
        async () => {
          const r = await request(app.getHttpServer())
            .get('/api/alerts?criticalOnly=true&limit=10');
          return r.body.some(
            (e: { level: string; weather: { temperatureC: number } }) =>
              e.level === 'CRITICAL_SENSOR_HEAT' && e.weather.temperatureC === 38,
          )
            ? true
            : undefined;
        },
        20_000,
        'climb-triggered sensor alert',
      );
    });

    it('stays silent on a cold morning warming into a hot noon', async () => {
      await request(app.getHttpServer())
        .post('/api/sensors')
        .set('X-API-Key', OPERATOR_KEY)
        .send({
          deviceId: 'e2e-morning-probe',
          label: 'e2e Morgensonde',
          latitude: DRILL_LAT,
          longitude: DRILL_LON,
        })
        .expect(201);

      // 8 → 26 °C is an eighteen-degree climb — and pure weather. The 35 °C
      // floor exists precisely so this never pages anyone.
      const base = Date.now() - 5 * 3_600_000;
      for (const [offsetH, temp] of [[0, 8], [1, 9], [2, 11], [3, 14]] as const) {
        await request(app.getHttpServer())
          .post('/api/sensors/readings')
          .set('X-Sensor-Token', SENSOR_TOKEN)
          .send({
            deviceId: 'e2e-morning-probe',
            observedAt: new Date(base + offsetH * 3_600_000).toISOString(),
            temperatureC: temp,
          })
          .expect(202);
      }
      await request(app.getHttpServer())
        .post('/api/sensors/readings')
        .set('X-Sensor-Token', SENSOR_TOKEN)
        .send({
          deviceId: 'e2e-morning-probe',
          observedAt: new Date().toISOString(),
          temperatureC: 26,
        })
        .expect(202);
      await new Promise((r) => setTimeout(r, 600));

      const res = await request(app.getHttpServer())
        .get('/api/alerts?criticalOnly=true&limit=20')
        .expect(200);
      expect(
        res.body.some(
          (e: { level: string; weather: { temperatureC: number } }) =>
            e.level === 'CRITICAL_SENSOR_HEAT' && e.weather.temperatureC === 26,
        ),
      ).toBe(false);
    });

    it('stores a retransmitted uplink once, not twice', async () => {
      await registerSensor('e2e-dedup');
      const observedAt = new Date().toISOString();
      const reading = { deviceId: 'e2e-dedup', observedAt, temperatureC: 19 };

      for (let i = 0; i < 2; i += 1) {
        await request(app.getHttpServer())
          .post('/api/sensors/readings')
          .set('X-Sensor-Token', SENSOR_TOKEN)
          .send(reading)
          .expect(202);
      }

      const { rows } = await db.query(
        `SELECT count(*) FROM sensor_readings
          WHERE sensor_id = (SELECT id FROM ground_sensors WHERE device_id = 'e2e-dedup');`,
      );
      expect(Number(rows[0].count)).toBe(1);
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
        .send({ ...body, geometry: { type: 'Polygon', coordinates: [polygon.coordinates[0]!.slice(0, 3)] } })
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
