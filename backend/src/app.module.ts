import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AlertsModule } from './alerts/alerts.module';
import { AnomaliesModule } from './anomalies/anomalies.module';
import { BackfillModule } from './backfill/backfill.module';
import { ConditionsModule } from './conditions/conditions.module';
import { ConfigurationModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { FireDangerModule } from './fire-danger/fire-danger.module';
import { ForecastModule } from './forecast/forecast.module';
import { HealthController } from './health/health.controller';
import { HistoryModule } from './history/history.module';
import { IncidentsModule } from './incidents/incidents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportModule } from './report/report.module';
import { RiskZonesModule } from './risk-zones/risk-zones.module';
import { SensorsModule } from './sensors/sensors.module';
import { SimulationModule } from './simulation/simulation.module';
import { ShutdownService } from './shutdown.service';

@Module({
  imports: [
    // Environment variables are the single configuration source (12-factor),
    // read and validated once at boot — a malformed threshold stops the
    // container here rather than becoming a NaN nobody notices.
    ConfigurationModule,

    // Rate limiting on a service that is public by design.
    //
    // The reads are meant to be watched, so the ceiling is generous — a
    // responder refreshing a situation map must never be told to slow down.
    // What it protects against is the cheap asymmetry: one GET on
    // /api/report/lagebericht.pdf makes the server query six subsystems and
    // render a document, and nothing else in the stack limits that.
    //
    // In-memory, so each replica counts its own callers. That is enough for
    // this: the aim is to stop one client hammering an expensive endpoint,
    // not to enforce a quota across a fleet.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 300 },
    ]),

    DatabaseModule,
    RiskZonesModule, // seeds high_risk_zones before evaluation starts
    EvaluationModule, // consumes detection reports, applies the phosphorus rule
    AlertsModule, // relays Redis alerts to Socket.IO clients
    AnomaliesModule, // REST read model (GeoJSON)
    FireDangerModule, // Canadian FWI per zone, computed by the workers
    ConditionsModule, // current conditions + per-zone readiness
    ForecastModule, // the ignition rule read forwards: when does the window open
    HistoryModule, // ...and read backwards: how often has it been open before
    IncidentsModule, // real events, laid against both — the thresholds' report card
    SensorsModule, // ground sensor registry + LoRaWAN intake
    SimulationModule, // POST /api/simulate-fire end-to-end drill trigger
    BackfillModule, // operator-triggered replays of the satellite archive
    ReportModule, // everything above, dated and on paper — the meeting document
    NotificationsModule, // relays critical alerts off the map, and watches
    // that ingestion is still running at all
  ],
  controllers: [HealthController],
  providers: [
    // Applied to every route; endpoints that need a tighter ceiling say so
    // with @Throttle, and the health check opts out with @SkipThrottle.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    ShutdownService,
  ],
})
export class AppModule {}
