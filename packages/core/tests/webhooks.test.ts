import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  Chariow,
  ChariowWebhookPayloadError,
  ChariowWebhookVerificationError,
  computePulseSignature,
  constructPulseEvent,
  InMemoryPulseIdempotencyStore,
  isValidPulseSignature,
  PulseEventProcessor,
  PulseWebhooks,
  verifyPulseSignature,
} from '../src/index.js';
import { TEST_API_KEY, TEST_PULSE_SECRET } from './helpers.js';

// Body with escaped slashes, as Chariow sends it: re-serializing it would change the bytes.
const rawBody =
  '{"event":"successful.sale","sale":{"id":"sal_xyz789abc","status":"completed","custom_metadata":{"order_ref":"ORD-123"}},' +
  '"product":{"id":"prd_def456","name":"Premium","url":"https:\\/\\/mystore.mychariow.com\\/premium","metadata":null},' +
  '"customer":{"id":"cus_abc123","email":"customer@example.com"},"affiliate":null,' +
  '"store":{"id":"str_xyz789","name":"My Store","url":"https:\\/\\/mystore.mychariow.com"}}';

function sign(body: string | Buffer, secret = TEST_PULSE_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function headers(body: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'x-chariow-signature': sign(body),
    'x-pulse-id': 'pulse_abc123',
    'x-pulse-delivery-id': 'dlv_001',
    'x-pulse-event': 'successful.sale',
    ...extra,
  };
}

function verificationReason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ChariowWebhookVerificationError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('Pulse signature', () => {
  it('computes sha256=<hex HMAC of the raw body>', () => {
    expect(computePulseSignature(rawBody, TEST_PULSE_SECRET)).toBe(sign(rawBody));
    expect(sign(rawBody)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('accepts a valid signature for string, Buffer, Uint8Array and ArrayBuffer bodies', () => {
    const signature = sign(rawBody);
    const buffer = Buffer.from(rawBody);
    const arrayBuffer = new Uint8Array(buffer).buffer;
    for (const body of [rawBody, buffer, new Uint8Array(buffer), arrayBuffer]) {
      expect(() => verifyPulseSignature({ rawBody: body, signature, secret: TEST_PULSE_SECRET })).not.toThrow();
    }
  });

  it('accepts an uppercase hex digest', () => {
    const signature = `sha256=${sign(rawBody).slice(7).toUpperCase()}`;
    expect(isValidPulseSignature({ rawBody, signature, secret: TEST_PULSE_SECRET })).toBe(true);
  });

  it('rejects a body that was re-serialized', () => {
    const reserialized = JSON.stringify(JSON.parse(rawBody));
    expect(reserialized).not.toBe(rawBody);
    expect(isValidPulseSignature({ rawBody: reserialized, signature: sign(rawBody), secret: TEST_PULSE_SECRET })).toBe(false);
  });

  it.each([
    [undefined, 'missing_signature'],
    ['', 'missing_signature'],
    ['sha1=abcdef', 'unsupported_scheme'],
    ['sha256=xyz', 'malformed_signature'],
    [`sha256=${'0'.repeat(64)}`, 'signature_mismatch'],
  ])('rejects signature %j with reason %s', (signature, reason) => {
    expect(verificationReason(() => verifyPulseSignature({ rawBody, signature, secret: TEST_PULSE_SECRET }))).toBe(reason);
  });

  it('rejects a signature made with another secret', () => {
    const signature = sign(rawBody, 'whsec_other');
    expect(verificationReason(() => verifyPulseSignature({ rawBody, signature, secret: TEST_PULSE_SECRET }))).toBe(
      'signature_mismatch',
    );
  });

  it('supports several secrets (several Pulses on one endpoint)', () => {
    const signature = sign(rawBody, 'whsec_second');
    expect(isValidPulseSignature({ rawBody, signature, secret: ['whsec_first', 'whsec_second'] })).toBe(true);
  });

  it('throws when no secret is configured', () => {
    expect(() => isValidPulseSignature({ rawBody, signature: sign(rawBody), secret: '' })).toThrow(
      ChariowWebhookVerificationError,
    );
  });

  it('refuses parsed objects as raw body', () => {
    expect(() =>
      verifyPulseSignature({ rawBody: JSON.parse(rawBody) as string, signature: sign(rawBody), secret: TEST_PULSE_SECRET }),
    ).toThrow(ChariowWebhookPayloadError);
  });
});

describe('constructPulseEvent', () => {
  it('returns a typed known event with delivery metadata', () => {
    const event = constructPulseEvent({ rawBody, headers: headers(rawBody), secret: TEST_PULSE_SECRET });
    expect(event).toMatchObject({ known: true, type: 'successful.sale', deliveryId: 'dlv_001', pulseId: 'pulse_abc123' });
    if (event.known && event.type === 'successful.sale') {
      expect(event.payload.sale.custom_metadata).toEqual({ order_ref: 'ORD-123' });
      expect(event.payload.product.url).toBe('https://mystore.mychariow.com/premium');
    } else {
      throw new Error('expected successful.sale');
    }
  });

  it('accepts fetch Headers and array header values', () => {
    const webhooks = new PulseWebhooks({ secret: TEST_PULSE_SECRET });
    expect(webhooks.constructEvent({ rawBody, headers: new Headers(headers(rawBody)) }).deliveryId).toBe('dlv_001');
    const nodeHeaders = { ...headers(rawBody), 'X-Pulse-Delivery-Id': undefined, 'x-pulse-delivery-id': ['dlv_arr'] };
    expect(webhooks.constructEvent({ rawBody, headers: nodeHeaders }).deliveryId).toBe('dlv_arr');
  });

  it('tolerates unknown events', () => {
    const body = '{"event":"subscription.renewed","subscription":{"id":"sub_1"}}';
    const event = constructPulseEvent({ rawBody: body, headers: headers(body), secret: TEST_PULSE_SECRET });
    expect(event.known).toBe(false);
    expect(event.type).toBe('subscription.renewed');
    expect(event.payload.subscription).toEqual({ id: 'sub_1' });
  });

  it('falls back to x-pulse-event when the body has no event field', () => {
    const body = '{"license":{"id":"lic_1","key":"K"}}';
    const event = constructPulseEvent({
      rawBody: body,
      headers: headers(body, { 'x-pulse-event': 'license.issued' }),
      secret: TEST_PULSE_SECRET,
    });
    expect(event).toMatchObject({ known: true, type: 'license.issued' });
  });

  it('verifies before parsing', () => {
    expect(() =>
      constructPulseEvent({ rawBody, headers: { ...headers(rawBody), 'x-chariow-signature': 'sha256=' + 'a'.repeat(64) }, secret: TEST_PULSE_SECRET }),
    ).toThrow(ChariowWebhookVerificationError);
  });

  it.each(['not json', '[1,2]', '{"foo":"bar"}'])('rejects invalid payload %j', (body) => {
    const { 'x-pulse-event': _omit, ...rest } = headers(body);
    expect(() => constructPulseEvent({ rawBody: body, headers: rest, secret: TEST_PULSE_SECRET })).toThrow(
      ChariowWebhookPayloadError,
    );
  });

  it('is available from the client', () => {
    const chariow = new Chariow({ apiKey: TEST_API_KEY, pulseSecret: TEST_PULSE_SECRET });
    expect(chariow.webhooks.constructEvent({ rawBody, headers: headers(rawBody) }).type).toBe('successful.sale');
  });
});

describe('PulseEventProcessor', () => {
  const webhooks = new PulseWebhooks({ secret: TEST_PULSE_SECRET });
  const event = (deliveryId: string) =>
    webhooks.constructEvent({ rawBody, headers: headers(rawBody, { 'x-pulse-delivery-id': deliveryId }) });

  it('dispatches to typed handlers and onAny', async () => {
    const onSale = vi.fn();
    const onAny = vi.fn();
    const onLicense = vi.fn();
    const processor = new PulseEventProcessor().on('successful.sale', onSale).on('license.issued', onLicense).onAny(onAny);
    await expect(processor.process(event('d1'))).resolves.toEqual({ status: 'processed', handlers: 2 });
    expect(onSale).toHaveBeenCalledOnce();
    expect(onAny).toHaveBeenCalledOnce();
    expect(onLicense).not.toHaveBeenCalled();
  });

  it('deduplicates on x-pulse-delivery-id', async () => {
    const handler = vi.fn();
    const processor = new PulseEventProcessor({ idempotencyStore: new InMemoryPulseIdempotencyStore() }).on(
      'successful.sale',
      handler,
    );
    expect((await processor.process(event('dup'))).status).toBe('processed');
    expect((await processor.process(event('dup'))).status).toBe('duplicate');
    expect((await processor.process(event('other'))).status).toBe('processed');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('releases the delivery id when a handler fails so the retry is processed', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(undefined);
    const processor = new PulseEventProcessor({ idempotencyStore: new InMemoryPulseIdempotencyStore() }).on(
      'successful.sale',
      handler,
    );
    await expect(processor.process(event('retry'))).rejects.toThrow('db down');
    await expect(processor.process(event('retry'))).resolves.toMatchObject({ status: 'processed' });
  });

  it('routes unknown events to onUnknown and reports unhandled events', async () => {
    const body = '{"event":"brand.new"}';
    const unknown = webhooks.constructEvent({ rawBody: body, headers: headers(body) });
    const onUnknown = vi.fn();
    expect(await new PulseEventProcessor().process(unknown)).toEqual({ status: 'unhandled', handlers: 0 });
    expect(await new PulseEventProcessor().onUnknown(onUnknown).process(unknown)).toEqual({ status: 'processed', handlers: 1 });
  });
});

describe('InMemoryPulseIdempotencyStore', () => {
  it('expires entries after the TTL', () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryPulseIdempotencyStore({ ttlMs: 1000 });
      expect(store.claim('a')).toBe(true);
      expect(store.claim('a')).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(store.claim('a')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds its size', () => {
    const store = new InMemoryPulseIdempotencyStore({ maxEntries: 2 });
    store.claim('a');
    store.claim('b');
    store.claim('c');
    expect(store.size).toBe(2);
    expect(store.claim('a')).toBe(true);
  });
});
