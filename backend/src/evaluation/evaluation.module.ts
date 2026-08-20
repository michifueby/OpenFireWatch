import { Module } from '@nestjs/common';

import { RiskZonesModule } from '../risk-zones/risk-zones.module';
import { SensorsModule } from '../sensors/sensors.module';
import { AnomalyEvaluationService } from './anomaly-evaluation.service';

@Module({
  imports: [RiskZonesModule, SensorsModule],
  providers: [AnomalyEvaluationService],
})
export class EvaluationModule {}
