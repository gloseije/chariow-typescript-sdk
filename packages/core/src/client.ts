import { CheckoutResource } from './checkout/checkout.js';
import { ChariowConfigurationError } from './errors/index.js';
import { type FetchLike, HttpClient, type HttpRequest, type HttpResponse } from './http/http-client.js';
import { LicensesResource } from './licenses/licenses.js';
import { PulsesResource } from './pulses/pulses.js';
import { SalesResource } from './sales/sales.js';
import { PulseWebhooks } from './webhooks/webhooks.js';

export const DEFAULT_BASE_URL = 'https://api.chariow.com/v1';
export const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface ChariowOptions {
  /** Secret API key (`sk_...`). Keep it server-side, e.g. `process.env.CHARIOW_API_KEY`. */
  apiKey: string;
  /** Pulse signing secret(s) (`whsec_...`), required only for `chariow.webhooks`. */
  pulseSecret?: string | readonly string[];
  /** Defaults to `https://api.chariow.com/v1`. Plain HTTP is only accepted for loopback hosts (tests). */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Custom `fetch` implementation. Defaults to the global `fetch` (Node.js >= 20). */
  fetch?: FetchLike;
}

/** Chariow API client. Server-side use only: it holds your secret API key. */
export class Chariow {
  readonly checkout: CheckoutResource;
  readonly sales: SalesResource;
  readonly licenses: LicensesResource;
  /** Read-only Pulse configuration endpoints. */
  readonly pulses: PulsesResource;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly #http: HttpClient;
  readonly #webhooks: PulseWebhooks | undefined;

  constructor(options: ChariowOptions) {
    if (typeof options !== 'object') {
      throw new ChariowConfigurationError('Chariow options are required');
    }
    const apiKey = validateApiKey(options.apiKey);
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const fetchImpl = options.fetch ?? defaultFetch();

    this.#http = new HttpClient({ apiKey, baseUrl: this.baseUrl, timeoutMs: this.timeoutMs, fetch: fetchImpl });
    this.checkout = new CheckoutResource(this.#http);
    this.sales = new SalesResource(this.#http);
    this.licenses = new LicensesResource(this.#http);
    this.pulses = new PulsesResource(this.#http);
    this.#webhooks = options.pulseSecret === undefined ? undefined : createWebhooks(options.pulseSecret);
  }

  /** Pulse signature verification, configured with `pulseSecret`. */
  get webhooks(): PulseWebhooks {
    if (!this.#webhooks) {
      throw new ChariowConfigurationError('pulseSecret must be configured to verify Pulse deliveries');
    }
    return this.#webhooks;
  }

  /**
   * Low-level authenticated request, for documented endpoints not wrapped by the SDK
   * (e.g. `GET /products`). The path is relative to the base URL.
   */
  request(request: HttpRequest): Promise<HttpResponse> {
    return this.#http.request(request);
  }

  toJSON(): { baseUrl: string; timeoutMs: number } {
    return { baseUrl: this.baseUrl, timeoutMs: this.timeoutMs };
  }
}

function validateApiKey(apiKey: unknown): string {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new ChariowConfigurationError(
      'A Chariow API key is required (apiKey). Load it from a server-side secret, e.g. process.env.CHARIOW_API_KEY',
    );
  }
  if (/\s/.test(apiKey)) {
    throw new ChariowConfigurationError('The Chariow API key must not contain whitespace');
  }
  return apiKey;
}

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ChariowConfigurationError('baseUrl must be an absolute URL');
  }
  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new ChariowConfigurationError('baseUrl must use HTTPS (plain HTTP is only allowed for localhost)');
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new ChariowConfigurationError('baseUrl must not contain credentials, a query string or a fragment');
  }
  return url.toString().replace(/\/+$/, '');
}

function validateTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ChariowConfigurationError('timeoutMs must be a positive integer (milliseconds)');
  }
  return timeoutMs;
}

function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') {
    throw new ChariowConfigurationError('No global fetch available: use Node.js >= 20 or pass the fetch option');
  }
  return (url, init) => globalThis.fetch(url, init);
}

function createWebhooks(secret: string | readonly string[]): PulseWebhooks {
  const secrets = typeof secret === 'string' ? [secret] : secret;
  if (secrets.length === 0 || secrets.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new ChariowConfigurationError('pulseSecret must be a non-empty string or array of strings');
  }
  return new PulseWebhooks({ secret });
}
