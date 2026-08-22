import { Module } from '@nestjs/common';

import { BackfillController } from './backfill.controller';
import { BackfillService } from './backfill.service';

@Module({
  controllers: [BackfillController],
  providers: [BackfillService],
})
export class BackfillModule {}
