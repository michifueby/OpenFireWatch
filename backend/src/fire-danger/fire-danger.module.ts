import { Module } from '@nestjs/common';

import { FireDangerController } from './fire-danger.controller';
import { FireDangerService } from './fire-danger.service';

@Module({
  controllers: [FireDangerController],
  providers: [FireDangerService],
  exports: [FireDangerService],
})
export class FireDangerModule {}
