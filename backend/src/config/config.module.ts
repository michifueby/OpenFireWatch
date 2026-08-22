/**
 * Makes the validated configuration injectable everywhere.
 *
 * Global, like DatabaseModule, because configuration is not a feature: every
 * module needs it and none of them owns it. Services inject `APP_CONFIG` and
 * receive a frozen, typed object — which is also what lets a test hand one
 * service a different threshold without touching `process.env` and hoping the
 * next test resets it.
 */

import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig, configSnapshot } from './environment';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      // Built once at boot. A malformed value throws here, before anything
      // has connected to anything — which is the point.
      useFactory: (): AppConfig => configSnapshot(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigurationModule {}
