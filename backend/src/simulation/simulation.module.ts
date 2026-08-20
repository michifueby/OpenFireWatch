import { Module } from '@nestjs/common';

import { SimulationController } from './simulation.controller';

/** Dev/ops drill tooling — see the guard note in SimulationController. */
@Module({
  controllers: [SimulationController],
})
export class SimulationModule {}
