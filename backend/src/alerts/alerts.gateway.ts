/**
 * AlertsGateway — the bridge between the Redis event bus and the browser.
 *
 * The persistence worker publishes confirmed anomalies (detections that
 * ST_Intersect an active risk zone) on the `alerts:anomalies` pub/sub
 * channel. This gateway subscribes to that channel and relays every alert
 * to ALL connected Socket.IO clients as an `anomaly:new` event — the Angular
 * map updates instantly, with zero page reloads and zero polling.
 *
 * Because the gateway holds no state of its own, the API scales
 * horizontally: every replica subscribes to the same channel and serves
 * its own slice of connected clients.
 */

import {
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import IORedis from 'ioredis';
import { Server, Socket } from 'socket.io';

/** Pub/sub channel name — must match the workers' `BUS.ALERTS_CHANNEL`. */
const ALERTS_CHANNEL = 'alerts:anomalies';

/** Socket.IO event name the Angular frontend listens for (all levels). */
const ANOMALY_EVENT = 'anomaly:new';

/**
 * Dedicated life-safety event: emitted IN ADDITION to `anomaly:new` whenever
 * the evaluation escalated to ANY critical level, so a client that only cares
 * about emergencies subscribes to exactly one event name.
 *
 * It replaced a per-level event name: with one critical level per hazard type
 * (phosphorus, wildfire, ordnance, generic) a client would otherwise have to
 * subscribe to each — and silently miss any level added later. The concrete
 * level is carried in the payload's `level` field.
 */
const CRITICAL_EVENT = 'alert:critical';

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(','),
  },
})
export class AlertsGateway
  implements OnModuleInit, OnModuleDestroy, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(AlertsGateway.name);

  /**
   * A DEDICATED Redis connection for subscribing. Redis puts connections in
   * subscriber mode once SUBSCRIBE is issued, so this connection must never
   * be shared with regular commands.
   */
  private subscriber: IORedis;

  async onModuleInit(): Promise<void> {
    this.subscriber = new IORedis({
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: Number(process.env.REDIS_DB ?? 0),
      // Reconnect forever with capped exponential backoff — a broker restart
      // must pause the alert relay, never kill the API.
      retryStrategy: (attempt) => Math.min(2 ** attempt * 100, 30_000),
    });

    await this.subscriber.subscribe(ALERTS_CHANNEL);

    this.subscriber.on('message', (channel: string, payload: string) => {
      if (channel !== ALERTS_CHANNEL) return;
      try {
        // -----------------------------------------------------------------
        // THE RELAY: one Redis message fans out to every connected browser.
        // -----------------------------------------------------------------
        const alert = JSON.parse(payload) as { level?: string };
        this.server.emit(ANOMALY_EVENT, alert);
        if (alert.level?.startsWith('CRITICAL_')) {
          this.server.emit(CRITICAL_EVENT, alert);
        }
      } catch {
        // A malformed message must never crash the relay loop.
        this.logger.error(`Dropped malformed alert payload: ${payload}`);
      }
    });

    this.logger.log(`Subscribed to Redis channel "${ALERTS_CHANNEL}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}
