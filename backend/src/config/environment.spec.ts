/**
 * Configuration is the layer where a typo becomes a silent safety failure, so
 * the tests are mostly about what happens when a value is wrong.
 */

import { loadConfig } from './environment';

describe('loadConfig', () => {
  it('runs on an empty environment — `docker compose up` needs no .env', () => {
    const config = loadConfig({});
    expect(config.database.host).toBe('db');
    expect(config.redis.port).toBe(6379);
    expect(config.api.port).toBe(8000);
    expect(config.sensors.alertTemperatureC).toBe(50);
  });

  it('refuses to start on a threshold that is not a number', () => {
    // This is the bug the module exists for. `Number('fifty')` is NaN, and a
    // threshold of NaN makes `reading >= threshold` false forever: the sensor
    // alert would never fire and nothing anywhere would say why.
    expect(() => loadConfig({ SENSOR_ALERT_TEMPERATURE_C: 'fifty' })).toThrowError(
      /SENSOR_ALERT_TEMPERATURE_C="fifty" is not a number/,
    );
  });

  it('reports every problem at once, not one per restart', () => {
    let message = '';
    try {
      loadConfig({ REDIS_PORT: 'abc', SENSOR_MAX_AGE_MINUTES: '-5' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('REDIS_PORT');
    expect(message).toContain('SENSOR_MAX_AGE_MINUTES');
  });

  it('rejects a value outside its usable range', () => {
    expect(() => loadConfig({ REDIS_DB: '99' })).toThrowError(/above the maximum/);
    expect(() => loadConfig({ POSTGRES_PORT: '0' })).toThrowError(/below the minimum/);
  });

  it('accepts API_PORT with the host prefix docker-compose puts there', () => {
    // The same variable binds the host interface in docker-compose, so
    // "127.0.0.1:8000" is a legitimate value for it.
    expect(loadConfig({ API_PORT: '127.0.0.1:8000' }).api.port).toBe(8000);
    expect(loadConfig({ API_PORT: '9000' }).api.port).toBe(9000);
  });

  it('rejects an API_PORT that contains no usable port', () => {
    expect(() => loadConfig({ API_PORT: 'localhost:' })).toThrowError(/API_PORT/);
    expect(() => loadConfig({ API_PORT: '0' })).toThrowError(/API_PORT/);
  });

  it('treats a blank credential as absent, so the guards fail closed', () => {
    // "   " must not count as a configured key — that would open writes to
    // anyone able to send three spaces.
    expect(loadConfig({ OPERATOR_API_KEY: '   ' }).auth.operatorApiKey).toBeUndefined();
    expect(loadConfig({}).auth.operatorApiKey).toBeUndefined();
    expect(loadConfig({ OPERATOR_API_KEY: ' s3cret ' }).auth.operatorApiKey).toBe('s3cret');
  });

  it('splits and trims the CORS origin list', () => {
    expect(
      loadConfig({ CORS_ORIGINS: 'https://a.example, https://b.example' }).api
        .corsOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('accepts only "en" as an override of the default notification language', () => {
    expect(loadConfig({}).notifications.language).toBe('de');
    expect(loadConfig({ NOTIFY_LANGUAGE: 'EN' }).notifications.language).toBe('en');
    // Anything else is a typo, and German is the deployment's language.
    expect(loadConfig({ NOTIFY_LANGUAGE: 'fr' }).notifications.language).toBe('de');
  });

  it('reads a zero that means something, rather than falling back', () => {
    // NOTIFY_ESCALATE_MINUTES=0 means "escalate immediately" — a `||` default
    // would silently turn that into fifteen minutes.
    expect(loadConfig({ NOTIFY_ESCALATE_MINUTES: '0' }).notifications.escalateMinutes).toBe(0);
    expect(loadConfig({ REDIS_DB: '0' }).redis.db).toBe(0);
  });
});
