import { Module } from '@nestjs/common';

import { AlertsModule } from '../alerts/alerts.module';
import { ConditionsModule } from '../conditions/conditions.module';
import { ForecastModule } from '../forecast/forecast.module';
import { HistoryModule } from '../history/history.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { SensorsModule } from '../sensors/sensors.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [
    ConditionsModule,
    AlertsModule,
    ForecastModule,
    HistoryModule,
    IncidentsModule,
    SensorsModule,
  ],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
