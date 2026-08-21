import { Module } from '@nestjs/common';

import { AlertHistoryService } from './alert-history.service';
import { AlertsController } from './alerts.controller';
import { AlertsGateway } from './alerts.gateway';

@Module({
  controllers: [AlertsController],
  providers: [AlertsGateway, AlertHistoryService],
  exports: [AlertHistoryService],
})
export class AlertsModule {}
