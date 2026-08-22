import { Module } from '@nestjs/common';

import { FireDangerModule } from '../fire-danger/fire-danger.module';
import { ConditionsController } from './conditions.controller';
import { ConditionsService } from './conditions.service';

@Module({
  imports: [FireDangerModule],
  controllers: [ConditionsController],
  providers: [ConditionsService],
  exports: [ConditionsService],
})
export class ConditionsModule {}
