import { ChariowWebhookPayloadError } from '../errors/index.js';
import { isRecord } from '../utils.js';
import { isKnownPulseEventName, type PulseEvent } from './events.js';
import { type PulseRawBody, rawBodyToString, verifyPulseSignature } from './signature.js';

export const PULSE_HEADERS = {
  signature: 'x-chariow-signature',
  pulseId: 'x-pulse-id',
  deliveryId: 'x-pulse-delivery-id',
  event: 'x-pulse-event',
} as const;

/** Fetch `Headers` or a Node/Express-style header object. */
export type PulseHeaders = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

export function getHeader(headers: PulseHeaders, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower || value === undefined) continue;
    const first: string | undefined = typeof value === 'string' ? value : value[0];
    return first ?? null;
  }
  return null;
}

export interface ConstructPulseEventInput {
  rawBody: PulseRawBody;
  headers: PulseHeaders;
}

export interface PulseWebhooksOptions {
  /** Pulse signing secret(s) `whsec_...` — distinct from the API key. */
  secret: string | readonly string[];
}

/** Verifies and parses Pulse deliveries. */
export class PulseWebhooks {
  readonly #secret: string | readonly string[];

  constructor(options: PulseWebhooksOptions) {
    this.#secret = options.secret;
  }

  /** Throws `ChariowWebhookVerificationError` if the signature is missing or invalid. */
  verify(rawBody: PulseRawBody, signature: string | null | undefined): void {
    verifyPulseSignature({ rawBody, signature, secret: this.#secret });
  }

  /**
   * Verifies the signature, then parses the body into a typed {@link PulseEvent}.
   * Unknown event names are returned with `known: false` instead of throwing.
   */
  constructEvent(input: ConstructPulseEventInput): PulseEvent {
    return constructPulseEvent({ ...input, secret: this.#secret });
  }
}

/** Functional variant of {@link PulseWebhooks.constructEvent}. */
export function constructPulseEvent(input: ConstructPulseEventInput & PulseWebhooksOptions): PulseEvent {
  verifyPulseSignature({
    rawBody: input.rawBody,
    signature: getHeader(input.headers, PULSE_HEADERS.signature),
    secret: input.secret,
  });
  return parseVerifiedPulse(input.rawBody, input.headers);
}

function parseVerifiedPulse(rawBody: PulseRawBody, headers: PulseHeaders): PulseEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBodyToString(rawBody)) as unknown;
  } catch (error) {
    throw new ChariowWebhookPayloadError('Pulse body is not valid JSON', { cause: error });
  }
  if (!isRecord(payload)) throw new ChariowWebhookPayloadError('Pulse body must be a JSON object');

  const eventHeader = getHeader(headers, PULSE_HEADERS.event);
  const type = typeof payload.event === 'string' && payload.event !== '' ? payload.event : eventHeader;
  if (!type) throw new ChariowWebhookPayloadError('Pulse body has no "event" field');

  const metadata = {
    deliveryId: getHeader(headers, PULSE_HEADERS.deliveryId),
    pulseId: getHeader(headers, PULSE_HEADERS.pulseId),
    eventHeader,
  };
  const typedPayload = { ...payload, event: type };
  if (isKnownPulseEventName(type)) {
    return { ...metadata, known: true, type, payload: typedPayload } as PulseEvent;
  }
  return { ...metadata, known: false, type, payload: typedPayload };
}
