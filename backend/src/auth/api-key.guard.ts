/**
 * ApiKeyGuard — protects every state-changing endpoint.
 *
 * Reads/queries stay public (a situation map is meant to be watched), but
 * anything that writes must present the operator key in `X-API-Key`.
 * Without this, anyone who can reach the port could redraw or retire hazard
 * zones, or inject fake alerts through the drill endpoint — in an emergency
 * warning system that is the difference between a demo and a deployment.
 *
 * Design choices:
 *   - FAIL CLOSED: if `OPERATOR_API_KEY` is unset, writes are refused rather
 *     than silently allowed. A misconfigured deployment is locked, not open.
 *   - Constant-time comparison, so the key cannot be recovered byte-by-byte
 *     by measuring response times.
 *
 * This is deliberately the simplest thing that is actually safe. A multi-user
 * deployment wants real accounts (OIDC/JWT) and an audit log of who changed
 * which zone; the guard is the seam where that would slot in.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.OPERATOR_API_KEY?.trim();
    if (!configured) {
      this.logger.error(
        'OPERATOR_API_KEY is not configured — refusing all write requests.',
      );
      throw new ServiceUnavailableException(
        'Write access is not configured on this deployment. Set OPERATOR_API_KEY.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.header(API_KEY_HEADER)?.trim();
    if (!presented || !matches(presented, configured)) {
      throw new UnauthorizedException('Missing or invalid API key.');
    }
    return true;
  }
}

/**
 * Constant-time equality. Both sides are hashed first so the comparison
 * always runs over equal-length buffers — otherwise the key length would
 * leak, and `timingSafeEqual` would throw on a mismatch.
 */
function matches(presented: string, configured: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}
