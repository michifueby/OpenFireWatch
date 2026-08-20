import { Module } from '@nestjs/common';

import { RiskZonesModule } from '../risk-zones/risk-zones.module';
import { AnomalyEvaluationService } from './anomaly-evaluation.service';

@Module({
  imports: [RiskZonesModule],
  providers: [AnomalyEvaluationService],
})
export class EvaluationModule {}
