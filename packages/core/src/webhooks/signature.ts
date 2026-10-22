import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChariowWebhookPayloadError, ChariowWebhookVerificationError } from '../errors/index.js';

/** Raw HTTP body exactly as received. Never pass a re-serialized JSON object. */
export type PulseRawBody = string | Uint8Array | ArrayBuffer;

export const PULSE_SIGNATURE_PREFIX = 'sha256=';
const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;

function toBuffer(rawBody: PulseRawBody): Buffer {
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (rawBody instanceof ArrayBuffer) return Buffer.from(rawBody);
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  throw new ChariowWebhookPayloadError(
    'rawBody must be the raw request body (string, Buffer, Uint8Array or ArrayBuffer), not a parsed object',
  );
}

function normalizeSecrets(secret: string | readonly string[] | undefined): string[] {
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (secrets.length === 0) {
    throw new ChariowWebhookVerificationError('missing_secret', 'No Pulse signing secret configured');
  }
  return secrets;
}

/** Computes `sha256=<hex>` = HMAC-SHA256(raw body, Pulse secret), as documented by Chariow. */
export function computePulseSignature(rawBody: PulseRawBody, secret: string): string {
  const [key] = normalizeSecrets(secret);
  return PULSE_SIGNATURE_PREFIX + createHmac('sha256', key as string).update(toBuffer(rawBody)).digest('hex');
}

export interface VerifyPulseSignatureInput {
  rawBody: PulseRawBody;
  /** Value of the `x-chariow-signature` header. */
  signature: string | null | undefined;
  /**
   * Pulse signing secret(s) (`whsec_...`). Pass several secrets when multiple Pulses
   * (each with its own secret) deliver to the same endpoint.
   */
  secret: string | readonly string[];
}

/**
 * Verifies the `x-chariow-signature` header in constant time.
 * Throws {@link ChariowWebhookVerificationError} when the signature is missing or invalid.
 */
export function verifyPulseSignature(input: VerifyPulseSignatureInput): void {
  const secrets = normalizeSecrets(input.secret);
  const header = input.signature?.trim();
  if (!header) {
    throw new ChariowWebhookVerificationError('missing_signature', 'Missing x-chariow-signature header');
  }
  if (!header.startsWith(PULSE_SIGNATURE_PREFIX)) {
    throw new ChariowWebhookVerificationError('unsupported_scheme', 'Unsupported Pulse signature scheme');
  }
  const hex = header.slice(PULSE_SIGNATURE_PREFIX.length);
  if (!HEX_DIGEST.test(hex)) {
    throw new ChariowWebhookVerificationError('malformed_signature', 'Malformed Pulse signature');
  }
  const received = Buffer.from(hex, 'hex');
  const body = toBuffer(input.rawBody);
  let valid = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(body).digest();
    if (expected.length === received.length && timingSafeEqual(expected, received)) valid = true;
  }
  if (!valid) {
    throw new ChariowWebhookVerificationError('signature_mismatch', 'Pulse signature does not match');
  }
}

/** Boolean variant of {@link verifyPulseSignature}. */
export function isValidPulseSignature(input: VerifyPulseSignatureInput): boolean {
  try {
    verifyPulseSignature(input);
    return true;
  } catch (error) {
    if (error instanceof ChariowWebhookVerificationError && error.reason !== 'missing_secret') return false;
    throw error;
  }
}

export function rawBodyToString(rawBody: PulseRawBody): string {
  return toBuffer(rawBody).toString('utf8');
}
