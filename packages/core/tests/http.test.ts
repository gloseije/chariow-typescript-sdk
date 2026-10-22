import { describe, expect, it } from 'vitest';
import {
  Chariow,
  ChariowAbortError,
  ChariowApiError,
  ChariowAuthenticationError,
  ChariowBadRequestError,
  ChariowConflictError,
  ChariowNetworkError,
  ChariowNotFoundError,
  ChariowPermissionError,
  ChariowRateLimitError,
  ChariowResponseError,
  ChariowServerError,
  ChariowTimeoutError,
  ChariowValidationError,
  type FetchLike,
} from '../src/index.js';
import { createFetchMock, headersOf, jsonResponse, TEST_API_KEY } from './helpers.js';

function client(fetch: FetchLike, timeoutMs?: number): Chariow {
  return new Chariow({ apiKey: TEST_API_KEY, fetch, ...(timeoutMs ? { timeoutMs } : {}) });
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

describe('HTTP layer', () => {
  it('sends the Bearer token and JSON headers', async () => {
    const { fetch, calls } = createFetchMock(jsonResponse({ data: { id: 'sal_1' } }));
    await client(fetch).sales.get('sal_1');
    const headers = headersOf(calls[0]);
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_API_KEY}`);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBeNull();
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('serializes query parameters and skips undefined values', async () => {
    const { fetch, calls } = createFetchMock(
      jsonResponse({ data: [], pagination: { has_more_pages: false, next_cursor: null } }),
    );
    await client(fetch).sales.list({ status: 'completed', per_page: 50, search: undefined, period: 'last7days' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/sales');
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'completed', per_page: '50', period: 'last7days' });
  });

  it.each([
    [400, ChariowBadRequestError],
    [401, ChariowAuthenticationError],
    [404, ChariowNotFoundError],
    [409, ChariowConflictError],
    [500, ChariowServerError],
    [503, ChariowServerError],
    [418, ChariowApiError],
  ])('maps HTTP %i to the right error class', async (status, ErrorClass) => {
    const { fetch } = createFetchMock(jsonResponse({ message: 'Nope', errors: [] }, status));
    const error = await captureError(client(fetch).sales.get('sal_1'));
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error).toBeInstanceOf(ChariowApiError);
    expect((error as ChariowApiError).status).toBe(status);
    expect((error as ChariowApiError).apiMessage).toBe('Nope');
  });

  it('exposes missing scopes on 403', async () => {
    const { fetch } = createFetchMock(
      jsonResponse({ message: 'Insufficient scope', data: [], errors: { scopes: ['licenses.write'] } }, 403),
    );
    const error = await captureError(client(fetch).licenses.revoke('ABC-123'));
    expect(error).toBeInstanceOf(ChariowPermissionError);
    expect((error as ChariowPermissionError).missingScopes).toEqual(['licenses.write']);
  });

  it('exposes field errors on 422', async () => {
    const { fetch } = createFetchMock(
      jsonResponse({ message: 'The given data was invalid.', errors: { email: ['The email field is required.'] } }, 422),
    );
    const error = await captureError(client(fetch).sales.get('sal_1'));
    expect(error).toBeInstanceOf(ChariowValidationError);
    expect((error as ChariowValidationError).fieldErrors).toEqual({ email: ['The email field is required.'] });
  });

  it('exposes documented rate-limit headers on 429', async () => {
    const { fetch } = createFetchMock(
      jsonResponse({ message: 'Too Many Attempts.' }, 429, {
        'retry-after': '42',
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1737000000',
      }),
    );
    const error = await captureError(client(fetch).sales.get('sal_1'));
    expect(error).toBeInstanceOf(ChariowRateLimitError);
    expect((error as ChariowRateLimitError).retryAfterSeconds).toBe(42);
    expect((error as ChariowRateLimitError).rateLimit).toEqual({
      retryAfterSeconds: 42,
      limit: 100,
      remaining: 0,
      reset: 1737000000,
    });
  });

  it('handles non-JSON error bodies', async () => {
    const { fetch } = createFetchMock(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await captureError(client(fetch).sales.get('sal_1'));
    expect(error).toBeInstanceOf(ChariowServerError);
    expect((error as ChariowServerError).apiMessage).toBeNull();
  });

  it('rejects an empty 2xx body where data is expected', async () => {
    const { fetch } = createFetchMock(new Response(null, { status: 200 }));
    await expect(client(fetch).sales.get('sal_1')).rejects.toBeInstanceOf(ChariowResponseError);
  });

  it('rejects a non-JSON 2xx body', async () => {
    const { fetch } = createFetchMock(new Response('not json', { status: 200 }));
    await expect(client(fetch).sales.get('sal_1')).rejects.toBeInstanceOf(ChariowResponseError);
  });

  it('wraps network failures without leaking the API key', async () => {
    const { fetch } = createFetchMock(new TypeError('fetch failed'));
    const error = await captureError(client(fetch).sales.get('sal_1'));
    expect(error).toBeInstanceOf(ChariowNetworkError);
    expect((error as Error).message).not.toContain(TEST_API_KEY);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  const hangingFetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'));
      });
    });

  it('times out', async () => {
    const error = await captureError(client(hangingFetch, 20).sales.get('sal_1'));
    expect(error).toBeInstanceOf(ChariowTimeoutError);
    expect(error).toBeInstanceOf(ChariowNetworkError);
    expect((error as ChariowTimeoutError).timeoutMs).toBe(20);
  });

  it('supports a per-call timeout', async () => {
    const error = await captureError(client(hangingFetch).sales.get('sal_1', { timeoutMs: 10 }));
    expect((error as ChariowTimeoutError).timeoutMs).toBe(10);
  });

  it('supports cancellation through AbortSignal', async () => {
    const controller = new AbortController();
    const promise = client(hangingFetch).sales.get('sal_1', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(ChariowAbortError);
  });

  it('does not send a request with an already aborted signal', async () => {
    const { fetch, calls } = createFetchMock();
    await expect(client(fetch).sales.get('sal_1', { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      ChariowAbortError,
    );
    expect(calls).toHaveLength(0);
  });

  it('redacts license keys from error messages', async () => {
    const { fetch } = createFetchMock(jsonResponse({ message: 'License not found' }, 404));
    const error = await captureError(client(fetch).licenses.get('SECRET-KEY-1234'));
    expect((error as ChariowApiError).path).toBe('/licenses/{licenseKey}');
    expect((error as Error).message).not.toContain('SECRET-KEY-1234');
  });
});
