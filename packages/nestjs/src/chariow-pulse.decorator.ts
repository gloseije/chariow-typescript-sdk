import { createParamDecorator, type ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { PulseEvent } from '@gloseije/chariow-sdk';
import { CHARIOW_PULSE_EVENT_PROPERTY } from './chariow.constants.js';
import type { ChariowPulseRequest } from './chariow-pulse.guard.js';

export function getPulseEventFromContext(context: ExecutionContext): PulseEvent {
  const request = context.switchToHttp().getRequest<ChariowPulseRequest>();
  const event = request[CHARIOW_PULSE_EVENT_PROPERTY];
  if (!event) {
    throw new InternalServerErrorException('@ChariowPulse() requires @UseGuards(ChariowPulseGuard)');
  }
  return event;
}

/** Injects the Pulse event verified by `ChariowPulseGuard`. */
export const ChariowPulse = createParamDecorator((_data: unknown, context: ExecutionContext): PulseEvent =>
  getPulseEventFromContext(context),
);
