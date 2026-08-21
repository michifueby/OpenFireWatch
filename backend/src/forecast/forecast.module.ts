import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { ForecastController } from './forecast.controller';
import { ForecastWatchdog } from './forecast-watchdog.service';
import { ForecastService } from './forecast.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ForecastController],
  providers: [ForecastService, ForecastWatchdog],
  exports: [ForecastService],
})
export class ForecastModule {}
