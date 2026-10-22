import { describe, expect, it } from 'vitest';
import {
  Chariow,
  ChariowInvalidRequestError,
  type CheckoutRequest,
  getCheckoutUrl,
  validateCheckoutRequest,
} from '../src/index.js';
import { bodyOf, createFetchMock, headersOf, jsonResponse, TEST_API_KEY } from './helpers.js';

const request: CheckoutRequest = {
  product_id: 'prd_abc123',
  email: 'buyer@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: { number: '0700000000', country_code: 'CI' },
  custom_metadata: { order_ref: 'ORD-123' },
  redirect_url: 'https://app.example.com/thanks',
};

const paymentResponse = {
  data: {
    step: 'payment',
    message: null,
    purchase: { id: 'sal_xyz', status: 'awaiting_payment' },
    payment: { checkout_url: 'https://pay.example/checkout/abc', transaction_id: 'txn_1', gateway: 'orqex' },
  },
};

describe('checkout.create', () => {
  it('POSTs the documented body to /checkout', async () => {
    const { fetch, calls } = createFetchMock(jsonResponse(paymentResponse));
    const chariow = new Chariow({ apiKey: TEST_API_KEY, fetch });
    const session = await chariow.checkout.create(request);

    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/checkout');
    expect(calls[0]?.init.method).toBe('POST');
    expect(headersOf(calls[0]).get('content-type')).toBe('application/json');
    expect(bodyOf(calls[0])).toEqual(request);
    expect(session.step).toBe('payment');
    expect(getCheckoutUrl(session)).toBe('https://pay.example/checkout/abc');
  });

  it('returns no checkout URL for completed or already purchased sessions', async () => {
    const { fetch } = createFetchMock(
      jsonResponse({
        data: { step: 'completed', message: null, purchase: { id: 'sal_free' }, payment: { checkout_url: null, transaction_id: null, gateway: null } },
      }),
      jsonResponse({
        data: { step: 'already_purchased', message: 'Already purchased', purchase: null, payment: { checkout_url: 'https://x', transaction_id: null, gateway: null } },
      }),
    );
    const chariow = new Chariow({ apiKey: TEST_API_KEY, fetch });
    expect(getCheckoutUrl(await chariow.checkout.create(request))).toBeNull();
    expect(getCheckoutUrl(await chariow.checkout.create(request))).toBeNull();
  });

  it('rejects requests violating documented constraints without calling the API', async () => {
    const { fetch, calls } = createFetchMock();
    const chariow = new Chariow({ apiKey: TEST_API_KEY, fetch });
    const invalid: CheckoutRequest = {
      ...request,
      email: ' ',
      first_name: 'x'.repeat(51),
      phone: { number: '', country_code: 'CI' },
      custom_metadata: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])),
      embed_origins: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com'],
    };
    await expect(chariow.checkout.create(invalid)).rejects.toBeInstanceOf(ChariowInvalidRequestError);
    expect(calls).toHaveLength(0);
    expect(validateCheckoutRequest(invalid)).toEqual([
      'email is required',
      'first_name must be at most 50 characters',
      'phone.number is required',
      'custom_metadata accepts at most 10 keys',
      'embed_origins accepts at most 4 origins',
    ]);
  });

  it('rejects metadata values longer than 255 characters', () => {
    expect(validateCheckoutRequest({ ...request, custom_metadata: { note: 'x'.repeat(256) } })).toEqual([
      'custom_metadata.note must be at most 255 characters',
    ]);
  });
});
