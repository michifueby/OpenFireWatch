import { Module } from '@nestjs/common';

import { SensorIngestGuard } from './sensor-ingest.guard';
import { SensorService } from './sensor.service';
import { SensorsController } from './sensors.controller';

@Module({
  controllers: [SensorsController],
  providers: [SensorService, SensorIngestGuard],
  // Exported for the evaluation: a detection inside a zone with a live sensor
  // is judged against measured ground conditions, not the regional estimate.
  exports: [SensorService],
})
export class SensorsModule {}
