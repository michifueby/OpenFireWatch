/**
 * The environment, read once, checked once.
 *
 * Twenty-six variables were being read at twenty-six call sites, each with its
 * own idea of what a bad value means. Three of the six numeric tunables ran
 * `Number(process.env.X ?? default)` with no guard, so
 * `SENSOR_ALERT_TEMPERATURE_C=fifty` became `NaN` — and a threshold of `NaN`
 * makes `reading >= threshold` false forever. The sensor alert would simply
 * never fire, and nothing anywhere would say why.
 *
 * So the rule here is: a malformed value stops the container at boot with a
 * message naming the variable, rather than degrading something quietly in
 * production. Every problem found is reported together — fixing one typo only
 * to hit the next on the following restart is its own kind of cruelty.
 *
 * Defaults are the development-compose values, so `docker compose up` needs no
 * `.env` at all; anything that must not have a default (credentials) is
 * optional here and enforced by the guard that needs it, which fails closed.
 */

/** Everything the API needs to run, grouped by what it configures. */
export interface AppConfig {
  readonly api: {
    readonly port: number;
    readonly corsOrigins: readonly string[];
    /** Canonical public address, used in notification links. */
    readonly publicUrl: string;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string | undefined;
    readonly poolSize: number;
  };
  readonly redis: {
    readonly host: string;
    readonly port: number;
    /** Logical DB index — lets a test run isolate itself from dev queues. */
    readonly db: number;
  };
  readonly auth: {
    /** Unset means writes are refused, not open — see ApiKeyGuard. */
    readonly operatorApiKey: string | undefined;
    readonly sensorIngestToken: string | undefined;
  };
  readonly sensors: {
    readonly maxAgeMinutes: number;
    readonly alertTemperatureC: number;
    readonly alertRiseC: number;
    readonly alertCooldownHours: number;
  };
  readonly notifications: {
    readonly language: 'de' | 'en';
    readonly minSeverity: string;
    readonly escalateMinutes: number;
    readonly telegramBotToken: string | undefined;
    readonly telegramChatId: string | undefined;
    readonly webhookUrl: string | undefined;
    readonly webhookSecret: string | undefined;
  };
  readonly forecast: {
    readonly warnHorizonHours: number;
  };
}

/** Injection token — services ask for `AppConfig`, never for `process.env`. */
export const APP_CONFIG = 'APP_CONFIG';

type Env = Record<string, string | undefined>;

let snapshot: AppConfig | undefined;

/**
 * The configuration, for the few places that run before the DI container
 * exists — a `@WebSocketGateway({ cors })` decorator is evaluated when the
 * class is defined, so it cannot be handed an injected value.
 *
 * Memoised, so this is the SAME object the container provides rather than a
 * second parse that could disagree with it.
 */
export function configSnapshot(): AppConfig {
  return (snapshot ??= loadConfig());
}

/** Test seam: drop the memoised snapshot so the next call re-reads the env. */
export function resetConfigSnapshot(): void {
  snapshot = undefined;
}

/**
 * Build the configuration, or throw listing everything that is wrong with it.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];

  /** A number that must be finite, and within bounds where bounds make sense. */
  const num = (
    key: string,
    fallback: number,
    bounds?: { min?: number; max?: number },
  ): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      problems.push(`${key}="${raw}" is not a number`);
      return fallback;
    }
    if (bounds?.min !== undefined && value < bounds.min) {
      problems.push(`${key}=${value} is below the minimum of ${bounds.min}`);
    }
    if (bounds?.max !== undefined && value > bounds.max) {
      problems.push(`${key}=${value} is above the maximum of ${bounds.max}`);
    }
    return value;
  };

  const str = (key: string, fallback: string): string =>
    env[key]?.trim() || fallback;

  /** Credentials and endpoints: absent is a valid state, blank is not. */
  const optional = (key: string): string | undefined =>
    env[key]?.trim() || undefined;

  const config: AppConfig = {
    api: {
      port: parsePort(env['API_PORT'], problems),
      corsOrigins: str('CORS_ORIGINS', 'http://localhost:4200')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      publicUrl: str('PUBLIC_URL', 'https://openfirewatch.org'),
    },
    database: {
      host: str('POSTGRES_HOST', 'db'),
      port: num('POSTGRES_PORT', 5432, { min: 1, max: 65535 }),
      name: str('POSTGRES_DB', 'openfirewatch'),
      user: str('POSTGRES_USER', 'openfirewatch'),
      password: optional('POSTGRES_PASSWORD'),
      poolSize: num('POSTGRES_POOL_SIZE', 10, { min: 1, max: 100 }),
    },
    redis: {
      host: str('REDIS_HOST', 'redis'),
      port: num('REDIS_PORT', 6379, { min: 1, max: 65535 }),
      db: num('REDIS_DB', 0, { min: 0, max: 15 }),
    },
    auth: {
      operatorApiKey: optional('OPERATOR_API_KEY'),
      sensorIngestToken: optional('SENSOR_INGEST_TOKEN'),
    },
    sensors: {
      // A reading older than this is context, never ground truth: a dead
      // sensor must not report calm for a wood that is drying out.
      maxAgeMinutes: num('SENSOR_MAX_AGE_MINUTES', 90, { min: 1 }),
      alertTemperatureC: num('SENSOR_ALERT_TEMPERATURE_C', 50),
      alertRiseC: num('SENSOR_ALERT_RISE_C', 15, { min: 0 }),
      alertCooldownHours: num('SENSOR_ALERT_COOLDOWN_HOURS', 6, { min: 0 }),
    },
    notifications: {
      language: str('NOTIFY_LANGUAGE', 'de').toLowerCase() === 'en' ? 'en' : 'de',
      minSeverity: str('NOTIFY_MIN_SEVERITY', 'warning').toLowerCase(),
      escalateMinutes: num('NOTIFY_ESCALATE_MINUTES', 15, { min: 0 }),
      telegramBotToken: optional('NOTIFY_TELEGRAM_BOT_TOKEN'),
      telegramChatId: optional('NOTIFY_TELEGRAM_CHAT_ID'),
      webhookUrl: optional('NOTIFY_WEBHOOK_URL'),
      webhookSecret: optional('NOTIFY_WEBHOOK_SECRET'),
    },
    forecast: {
      warnHorizonHours: num('FORECAST_WARN_HOURS', 72, { min: 1 }),
    },
  };

  if (problems.length > 0) {
    throw new Error(
      `Invalid configuration:\n  - ${problems.join('\n  - ')}\n` +
        'Fix the environment and restart. See .env.example.',
    );
  }

  return config;
}

/**
 * API_PORT may legitimately carry a host-interface prefix ("127.0.0.1:8000")
 * because docker-compose uses the same variable for the host binding. Take the
 * last colon-separated segment.
 */
function parsePort(raw: string | undefined, problems: string[]): number {
  const trimmed = raw?.trim();
  // Unset is fine and means the default. Set-but-unusable is not: somebody
  // meant to choose a port, and quietly listening on a different one is how a
  // deployment ends up unreachable with nothing in the log about it.
  if (!trimmed) return 8000;

  const port = Number.parseInt(trimmed.split(':').pop() ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`API_PORT="${raw}" does not contain a usable port number`);
    return 8000;
  }
  return port;
}
