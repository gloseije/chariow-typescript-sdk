import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ChariowWebhookPayloadError,
  ChariowWebhookVerificationError,
  type PulseEvent,
  type PulseHeaders,
  type PulseRawBody,
} from '@gloseije/chariow-sdk';
import { CHARIOW_PULSE_EVENT_PROPERTY } from './chariow.constants.js';
import { ChariowService } from './chariow.service.js';

/** Minimal shape of an Express / Fastify request handled by the guard. */
export interface ChariowPulseRequest {
  headers: PulseHeaders;
  rawBody?: PulseRawBody;
  body?: unknown;
  [CHARIOW_PULSE_EVENT_PROPERTY]?: PulseEvent;
}

/**
 * Verifies the `x-chariow-signature` header of an incoming Pulse and stores the parsed event
 * on the request (read it with `@ChariowPulse()`). Requires the raw body:
 * `NestFactory.create(AppModule, { rawBody: true })`.
 */
@Injectable()
export class ChariowPulseGuard implements CanActivate {
  constructor(@Inject(ChariowService) private readonly chariow: ChariowService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ChariowPulseRequest>();
    const rawBody = extractRawBody(request);
    if (rawBody === undefined) {
      throw new InternalServerErrorException(
        'Raw request body unavailable: enable rawBody in NestFactory.create() to verify Chariow Pulses',
      );
    }
    try {
      request[CHARIOW_PULSE_EVENT_PROPERTY] = this.chariow.constructPulseEvent(rawBody, request.headers);
      return true;
    } catch (error) {
      if (error instanceof ChariowWebhookVerificationError) {
        if (error.reason === 'missing_secret') {
          throw new InternalServerErrorException('Chariow Pulse secret is not configured');
        }
        throw new UnauthorizedException('Invalid Chariow Pulse signature');
      }
      if (error instanceof ChariowWebhookPayloadError) {
        throw new BadRequestException('Invalid Chariow Pulse payload');
      }
      throw error;
    }
  }
}

function extractRawBody(request: ChariowPulseRequest): PulseRawBody | undefined {
  if (request.rawBody !== undefined) return request.rawBody;
  const body = request.body;
  if (typeof body === 'string' || body instanceof Uint8Array) return body;
  return undefined;
}
