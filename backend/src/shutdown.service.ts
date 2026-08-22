/**
 * Says out loud that the shutdown sequence ran.
 *
 * Not decoration. Until `enableShutdownHooks()` was called in main.ts, none of
 * this application's teardown ever executed: eight Redis connections, a pg
 * pool, three timers and a BullMQ worker all had careful `onModuleDestroy`
 * implementations that NestJS was never asked to invoke, so every `docker
 * compose stop` and every rolling deploy simply shot the process.
 *
 * From the outside those two cases look the same — the container stops either
 * way. This line is how a deployment can tell them apart, which matters the
 * first time somebody wonders whether a redeploy dropped an in-flight alert.
 */

import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ShutdownService
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger('Shutdown');

  beforeApplicationShutdown(signal?: string): void {
    this.logger.log(`${signal ?? 'shutdown'} received — closing connections`);
  }

  onApplicationShutdown(): void {
    this.logger.log('All modules torn down');
  }
}
