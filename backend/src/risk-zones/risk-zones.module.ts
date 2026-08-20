import { Module } from '@nestjs/common';

import { RiskZoneService } from './risk-zone.service';
import { RiskZonesController } from './risk-zones.controller';

@Module({
  controllers: [RiskZonesController],
  providers: [RiskZoneService],
  exports: [RiskZoneService],
})
export class RiskZonesModule {}
