/**
 * DatabaseService — the single shared PostgreSQL/PostGIS connection pool.
 *
 * Every domain service queries through this thin wrapper instead of owning
 * its own pool: one pool means predictable connection pressure on the
 * database and one place to add instrumentation (timing, tracing) later.
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'db',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'openfirewatch',
    user: process.env.POSTGRES_USER ?? 'openfirewatch',
    password: process.env.POSTGRES_PASSWORD,
    max: 10,
  });

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
