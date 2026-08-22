/**
 * How this application connects to Redis — stated once.
 *
 * Eight services had each written out the same four lines, and they had
 * drifted: some set `maxRetriesPerRequest: 3`, one set it to `null`, three
 * omitted the retry strategy entirely. Those are not stylistic differences.
 * `maxRetriesPerRequest: null` means "block and wait through a broker
 * restart", which is what BullMQ requires and what a subscriber wants; a
 * finite value means "fail the command", which is what a request handler
 * wants so a hung broker cannot hang an HTTP response.
 *
 * Naming the two intentions makes the choice deliberate at each call site
 * instead of inherited from whichever service was copied.
 */

import { Logger } from '@nestjs/common';
import IORedis, { RedisOptions } from 'ioredis';

import { AppConfig } from '../config/environment';

/**
 * What the connection is for.
 *
 * - `request`  serving an HTTP request: fail fast, so a broker outage
 *              surfaces as an error instead of a stalled response.
 * - `stream`   a subscriber, publisher or queue consumer that must survive a
 *              broker restart and pick up where it left off.
 */
export type RedisRole = 'request' | 'stream';

/** Capped exponential backoff: a broker restart pauses work, never ends it. */
const backoff = (attempt: number): number => Math.min(2 ** attempt * 100, 30_000);

export function redisOptions(config: AppConfig, role: RedisRole): RedisOptions {
  return {
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.db,
    retryStrategy: backoff,
    // BullMQ refuses a connection with a finite value here, because its
    // workers block on BRPOPLPUSH for longer than any retry budget.
    maxRetriesPerRequest: role === 'stream' ? null : 3,
  };
}

export function createRedis(config: AppConfig, role: RedisRole): IORedis {
  const client = new IORedis(redisOptions(config, role));
  // Without a listener, ioredis emits an unhandled 'error' event and takes
  // the process down on the first broker hiccup. Logged and swallowed: the
  // retry strategy above is what actually deals with it.
  client.on('error', (error: Error) => {
    new Logger('Redis').warn(`${role} connection: ${error.message}`);
  });
  return client;
}

/** Close a set of connections without letting one failure hide the others. */
export async function quitAll(
  ...clients: readonly (IORedis | undefined)[]
): Promise<void> {
  await Promise.allSettled(
    clients.filter((client): client is IORedis => !!client).map((c) => c.quit()),
  );
}
