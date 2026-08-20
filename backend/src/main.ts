/**
 * OpenFireWatch API — application bootstrap.
 *
 * The API layer is STATELESS by design: it holds no in-memory truth, only
 * relays events (Redis pub/sub → Socket.IO) and serves validated reads from
 * PostGIS. Any number of replicas can run behind a load balancer.
 */

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(','),
  });

  // OpenAPI/Swagger — generated straight from decorators and DTOs.
  const openApiConfig = new DocumentBuilder()
    .setTitle('OpenFireWatch API')
    .setDescription('Geospatial early warning system for thermal anomalies')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApiConfig));

  // API_PORT may legitimately carry a host-interface prefix in .env
  // ("127.0.0.1:8000") because docker-compose uses the same variable for the
  // host binding. Take the last colon-separated segment, and fall back rather
  // than crashing on anything unparseable — a listening service on the default
  // port is always better than none.
  const rawPort = process.env.API_PORT?.split(':').pop() ?? '';
  const port = Number.parseInt(rawPort, 10);
  await app.listen(Number.isInteger(port) && port > 0 && port < 65536 ? port : 8000, '0.0.0.0');
}

void bootstrap();
