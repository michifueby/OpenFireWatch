import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AlertsModule } from './alerts/alerts.module';
import { AnomaliesModule } from './anomalies/anomalies.module';
import { ConditionsModule } from './conditions/conditions.module';
import { DatabaseModule } from './database/database.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { ForecastModule } from './forecast/forecast.module';
import { HealthController } from './health/health.controller';
import { HistoryModule } from './history/history.module';
import { IncidentsModule } from './incidents/incidents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportModule } from './report/report.module';
import { RiskZonesModule } from './risk-zones/risk-zones.module';
import { SensorsModule } from './sensors/sensors.module';
import { SimulationModule } from './simulation/simulation.module';

@Module({
  imports: [
    // Environment variables are the single configuration source (12-factor).
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RiskZonesModule, // seeds high_risk_zones before evaluation starts
    EvaluationModule, // consumes detection reports, applies the phosphorus rule
    AlertsModule, // relays Redis alerts to Socket.IO clients
    AnomaliesModule, // REST read model (GeoJSON)
    ConditionsModule, // current conditions + per-zone readiness
    ForecastModule, // the ignition rule read forwards: when does the window open
    HistoryModule, // ...and read backwards: how often has it been open before
    IncidentsModule, // real events, laid against both — the thresholds' report card
    SensorsModule, // ground sensor registry + LoRaWAN intake
    SimulationModule, // POST /api/simulate-fire end-to-end drill trigger
    ReportModule, // everything above, dated and on paper — the meeting document
    NotificationsModule, // relays critical alerts off the map, and watches
    // that ingestion is still running at all
  ],
  controllers: [HealthController],
})
export class AppModule {}
