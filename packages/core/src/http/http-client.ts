import {
  ChariowAbortError,
  ChariowApiError,
  type ChariowApiErrorDetails,
  ChariowAuthenticationError,
  ChariowBadRequestError,
  ChariowConflictError,
  ChariowNetworkError,
  ChariowNotFoundError,
  ChariowPermissionError,
  type ChariowRateLimitInfo,
  ChariowRateLimitError,
  ChariowResponseError,
  ChariowServerError,
  ChariowTimeoutError,
  ChariowValidationError,
} from '../errors/index.js';
import { isRecord } from '../utils.js';

export type HttpMethod = 'GET' | 'POST';

export type QueryValue = string | number | boolean | null | undefined;

/** Minimal `fetch` signature used by the SDK; `globalThis.fetch` satisfies it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Per-call options accepted by every SDK method. */
export interface RequestOptions {
  /** Cancels the request when aborted. */
  signal?: AbortSignal;
  /** Overrides the client timeout for this call, in milliseconds. */
  timeoutMs?: number;
}

export interface HttpRequest extends RequestOptions {
  method: HttpMethod;
  /** Path relative to the base URL, already URL-encoded. */
  path: string;
  /** Path reported in errors; use it to hide sensitive path segments. Defaults to `path`. */
  redactedPath?: string;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or `undefined` when the body is empty. */
  body: unknown;
}

export interface HttpClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetch: FetchLike;
}

/** Thin wrapper around `fetch` that centralises auth, serialization, timeouts and error mapping. */
export class HttpClient {
  readonly #config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.#config = config;
  }

  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const url = this.buildUrl(request.path, request.query);
    const redactedPath = request.redactedPath ?? request.path;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.#config.apiKey}`,
    };
    let body: string | undefined;
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(request.body);
    }

    const timeoutMs = request.timeoutMs ?? this.#config.timeoutMs;
    const controller = new AbortController();
    const state = { timedOut: false, userAborted: false };
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const userSignal = request.signal;
    const onUserAbort = (): void => {
      state.userAborted = true;
      controller.abort();
    };
    if (userSignal) {
      if (userSignal.aborted) {
        clearTimeout(timer);
        throw new ChariowAbortError('Request aborted before being sent');
      }
      userSignal.addEventListener('abort', onUserAbort, { once: true });
    }

    try {
      let response: Response;
      let text: string;
      try {
        const init: RequestInit = { method: request.method, headers, signal: controller.signal };
        if (body !== undefined) init.body = body;
        response = await this.#config.fetch(url, init);
        text = await response.text();
      } catch (error) {
        if (state.timedOut) throw new ChariowTimeoutError(timeoutMs);
        if (state.userAborted) throw new ChariowAbortError('Request aborted', { cause: error });
        throw new ChariowNetworkError(
          `Unable to reach Chariow (${request.method} ${redactedPath})`,
          { cause: error },
        );
      }

      const parsed = parseBody(text);
      if (!response.ok) {
        throw createApiError(response, parsed.ok ? parsed.value : undefined, request.method, redactedPath);
      }
      if (!parsed.ok) {
        throw new ChariowResponseError(
          `Chariow returned a non-JSON body for ${request.method} ${redactedPath}`,
          response.status,
          { cause: parsed.error },
        );
      }
      return { status: response.status, headers: response.headers, body: parsed.value };
    } finally {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
    }
  }

  private buildUrl(path: string, query?: Readonly<Record<string, QueryValue>>): string {
    const url = new URL(this.#config.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

type ParseResult = { ok: true; value: unknown } | { ok: false; error: unknown };

function parseBody(text: string): ParseResult {
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error };
  }
}

function readNumberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Reads the rate-limit headers documented by Chariow. */
export function readRateLimitInfo(headers: Headers): ChariowRateLimitInfo {
  return {
    retryAfterSeconds: readNumberHeader(headers, 'retry-after'),
    limit: readNumberHeader(headers, 'x-ratelimit-limit'),
    remaining: readNumberHeader(headers, 'x-ratelimit-remaining'),
    reset: readNumberHeader(headers, 'x-ratelimit-reset'),
  };
}

function createApiError(
  response: Response,
  body: unknown,
  method: string,
  path: string,
): ChariowApiError {
  const record = isRecord(body) ? body : {};
  const details: ChariowApiErrorDetails = {
    status: response.status,
    method,
    path,
    apiMessage: typeof record.message === 'string' ? record.message : null,
    errors: record.errors,
    data: record.data,
  };
  switch (response.status) {
    case 400:
      return new ChariowBadRequestError(details);
    case 401:
      return new ChariowAuthenticationError(details);
    case 403:
      return new ChariowPermissionError(details);
    case 404:
      return new ChariowNotFoundError(details);
    case 409:
      return new ChariowConflictError(details);
    case 422:
      return new ChariowValidationError(details);
    case 429:
      return new ChariowRateLimitError(details, readRateLimitInfo(response.headers));
    default:
      return response.status >= 500 ? new ChariowServerError(details) : new ChariowApiError(details);
  }
}

/** Extracts `data` from a `{ data: ... }` envelope. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- response type declared by the caller
export function unwrapData<T>(response: HttpResponse, description: string): T {
  if (!isRecord(response.body) || !('data' in response.body)) {
    throw new ChariowResponseError(
      `Unexpected response body for ${description}: missing "data" envelope`,
      response.status,
    );
  }
  return response.body.data as T;
}

/** Validates a `{ data: [...], pagination: {...} }` list envelope. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- response types declared by the caller
export function unwrapList<T, P>(response: HttpResponse, description: string): { data: T[]; pagination: P } {
  const body = response.body;
  if (!isRecord(body) || !Array.isArray(body.data) || !isRecord(body.pagination)) {
    throw new ChariowResponseError(
      `Unexpected response body for ${description}: missing "data" or "pagination"`,
      response.status,
    );
  }
  return { data: body.data as T[], pagination: body.pagination as P };
}
