import { ChariowInvalidRequestError } from '../errors/index.js';
import { type HttpClient, type RequestOptions, unwrapData } from '../http/http-client.js';
import type { CheckoutRequest, CheckoutSession } from '../types/checkout.js';

const MAX_NAME_LENGTH = 50;
const MAX_REDIRECT_URL_LENGTH = 2048;
const MAX_METADATA_KEYS = 10;
const MAX_METADATA_VALUE_LENGTH = 255;
const MAX_EMBED_ORIGINS = 4;

/** `POST /checkout` (scope `checkout.write`). */
export class CheckoutResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Starts a checkout. When `step` is `payment`, redirect the buyer to
   * `payment.checkout_url`. The final payment status must be confirmed through a
   * signed Pulse or `sales.get()`, never through the browser redirect.
   */
  async create(params: CheckoutRequest, options: RequestOptions = {}): Promise<CheckoutSession> {
    const issues = validateCheckoutRequest(params);
    if (issues.length > 0) throw new ChariowInvalidRequestError(issues);
    const response = await this.#http.request({ ...options, method: 'POST', path: '/checkout', body: params });
    return unwrapData<CheckoutSession>(response, 'POST /checkout');
  }
}

/** Returns the hosted payment URL when the buyer must pay, `null` otherwise. */
export function getCheckoutUrl(session: CheckoutSession): string | null {
  return session.step === 'payment' ? session.payment.checkout_url : null;
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** Checks the constraints documented for `POST /checkout`. Returns human-readable issues. */
export function validateCheckoutRequest(params: CheckoutRequest): string[] {
  const issues: string[] = [];
  for (const field of ['product_id', 'email', 'first_name', 'last_name'] as const) {
    if (isBlank(params[field])) issues.push(`${field} is required`);
  }
  if (params.first_name.length > MAX_NAME_LENGTH) issues.push(`first_name must be at most ${MAX_NAME_LENGTH} characters`);
  if (params.last_name.length > MAX_NAME_LENGTH) issues.push(`last_name must be at most ${MAX_NAME_LENGTH} characters`);
  if (isBlank(params.phone.number)) issues.push('phone.number is required');
  if (isBlank(params.phone.country_code)) issues.push('phone.country_code is required');
  if (params.redirect_url !== undefined && params.redirect_url.length > MAX_REDIRECT_URL_LENGTH) {
    issues.push(`redirect_url must be at most ${MAX_REDIRECT_URL_LENGTH} characters`);
  }
  if (params.custom_metadata !== undefined) {
    const entries = Object.entries(params.custom_metadata);
    if (entries.length > MAX_METADATA_KEYS) issues.push(`custom_metadata accepts at most ${MAX_METADATA_KEYS} keys`);
    for (const [key, value] of entries) {
      if (typeof value !== 'string') {
        issues.push(`custom_metadata.${key} must be a string`);
      } else if (value.length > MAX_METADATA_VALUE_LENGTH) {
        issues.push(`custom_metadata.${key} must be at most ${MAX_METADATA_VALUE_LENGTH} characters`);
      }
    }
  }
  if (params.embed_origins !== undefined && params.embed_origins.length > MAX_EMBED_ORIGINS) {
    issues.push(`embed_origins accepts at most ${MAX_EMBED_ORIGINS} origins`);
  }
  return issues;
}
