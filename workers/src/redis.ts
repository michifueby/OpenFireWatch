/**
 * Shared Redis connection factory.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connections so that
 * commands block-and-wait during a broker hiccup instead of throwing —
 * a core piece of the fault-tolerance story: a Redis restart pauses the
 * pipeline, it does not crash it.
 */

import IORedis from 'ioredis';

import { config } from './config';

export function createRedisConnection(): IORedis {
  return new IORedis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    db: config.REDIS_DB,
    maxRetriesPerRequest: null,
    // Exponential reconnect backoff, capped at 30s between attempts.
    retryStrategy: (attempt) => Math.min(2 ** attempt * 100, 30_000),
  });
}
