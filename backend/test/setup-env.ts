/**
 * E2E environment defaults — loaded by Jest (`setupFiles`) BEFORE any
 * application module is imported, so every service reads test-scoped
 * connection settings.
 *
 * Isolation strategy (no mocked infrastructure — this is an INTEGRATION
 * test against the real PostGIS + Redis from docker-compose):
 *   - a DEDICATED database (`openfirewatch_e2e`), created fresh per run, and
 *   - a DEDICATED Redis logical DB (index 15), flushed per run,
 * so the suite can never race the dev stack's own workers or dirty its data.
 *
 * Explicit env vars (e.g. in CI) always win over these local defaults.
 */

process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? '127.0.0.1';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5432';
process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? 'openfirewatch';
process.env.POSTGRES_PASSWORD =
  process.env.POSTGRES_PASSWORD ?? 'change-me-in-production';
// The suite creates/drops this database itself in beforeAll/afterAll.
process.env.POSTGRES_DB = 'openfirewatch_e2e';

process.env.REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
// Logical DB 15: BullMQ queues + pub/sub stay invisible to the dev stack.
process.env.REDIS_DB = '15';

// Writes are guarded by ApiKeyGuard; the suite exercises both the accepted
// and the rejected path, so the key must be known here.
process.env.OPERATOR_API_KEY = 'e2e-test-operator-key';

// The sensor intake has its own credential (a gateway must not hold the
// operator key); the suite exercises accept and reject paths for it too.
process.env.SENSOR_INGEST_TOKEN = 'e2e-test-sensor-token';
