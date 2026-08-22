/**
 * DatabaseService — the single shared PostgreSQL/PostGIS connection pool.
 *
 * Every domain service queries through this thin wrapper instead of owning
 * its own pool: one pool means predictable connection pressure on the
 * database and one place to add instrumentation (timing, tracing) later.
 */

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

import { APP_CONFIG, AppConfig } from '../config/environment';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      max: config.database.poolSize,
    });
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as never[]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
