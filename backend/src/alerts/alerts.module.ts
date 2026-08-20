import { Module } from '@nestjs/common';

import { AlertsGateway } from './alerts.gateway';

@Module({
  providers: [AlertsGateway],
})
export class AlertsModule {}
