import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AlertsModule } from './alerts/alerts.module';
import { AnomaliesModule } from './anomalies/anomalies.module';
import { ConditionsModule } from './conditions/conditions.module';
import { DatabaseModule } from './database/database.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';
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
    SensorsModule, // ground sensor registry + LoRaWAN intake
    SimulationModule, // POST /api/simulate-fire end-to-end drill trigger
    NotificationsModule, // relays critical alerts off the map, and watches
    // that ingestion is still running at all
  ],
  controllers: [HealthController],
})
export class AppModule {}
