import { Global, Module } from '@nestjs/common';

import { DatabaseService } from './database.service';

/** Global: every feature module can inject DatabaseService without imports. */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
