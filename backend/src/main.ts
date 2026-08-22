/**
 * OpenFireWatch API — application bootstrap.
 *
 * The API layer is STATELESS by design: it holds no in-memory truth, only
 * relays events (Redis pub/sub → Socket.IO) and serves validated reads from
 * PostGIS. Any number of replicas can run behind a load balancer.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/environment';
import { APP_VERSION, GIT_REVISION } from './version';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

  // Without this, NestJS never calls onModuleDestroy on SIGTERM — and this
  // application has eight Redis connections, a pg pool, three timers and a
  // BullMQ worker whose shutdown handlers were, until now, dead code. A
  // rolling deploy killed the process with all of them open.
  app.enableShutdownHooks();

  // The API always runs behind at least one proxy (nginx, and Caddy in
  // production), so the client address has to come from X-Forwarded-For or
  // the rate limiter counts every visitor as the same caller.
  //
  // Expressed as trusted NETWORKS rather than a hop count: Express then walks
  // the header from the right and stops at the first address that is not
  // private, which lands on the real client whether there is one proxy in
  // front of it or two. A hop count would have to be changed when the
  // deployment topology changes, and would be wrong silently until someone
  // noticed the limit applying to the wrong address.
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

  // Everything lives under /api — keeps proxying from nginx trivial.
  app.setGlobalPrefix('api');

  // STRICT validation on every request:
  //  - whitelist: silently strips properties not declared on the DTO
  //  - forbidNonWhitelisted: ...and rejects the request if any were sent
  //  - transform: converts query strings to their declared types (numbers etc.)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS for the Angular dev server; in production nginx serves both origins.
  app.enableCors({ origin: [...config.api.corsOrigins] });

  // OpenAPI/Swagger — generated straight from decorators and DTOs.
  const openApiConfig = new DocumentBuilder()
    .setTitle('OpenFireWatch API')
    .setDescription('Geospatial early warning system for thermal anomalies')
    // From the manifest, so the documented version cannot claim to be a
    // release the running code is not.
    .setVersion(APP_VERSION)
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApiConfig));

  await app.listen(config.api.port, '0.0.0.0');

  // Logged on the first line of every container start, so `docker compose
  // logs backend | head` answers "what is deployed right now" without
  // reaching for the API.
  Logger.log(
    `OpenFireWatch API v${APP_VERSION} (${GIT_REVISION})`,
    'Bootstrap',
  );
}

void bootstrap();
