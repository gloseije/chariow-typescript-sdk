import type { FetchLike, License } from '../src/index.js';

/** Fake key used by the tests only — never a real Chariow key. */
export const TEST_API_KEY = 'sk_test_fake_key_for_unit_tests_only';
export const TEST_PULSE_SECRET = 'whsec_fake_secret_for_unit_tests_only';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

type MockResult = Response | Error | ((url: string, init: RequestInit) => Response | Promise<Response>);

export function createFetchMock(...results: MockResult[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = results.shift();
    if (next === undefined) throw new Error('Unexpected fetch call');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function headersOf(call: RecordedCall | undefined): Headers {
  return new Headers(call?.init.headers);
}

export function bodyOf(call: RecordedCall | undefined): unknown {
  const body = call?.init.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

export const paginationFixture = {
  count: 1,
  path: 'https://api.chariow.com/v1/licenses',
  per_page: 10,
  next_cursor: null,
  next_page_url: null,
  prev_cursor: null,
  prev_page_url: null,
  has_more_pages: false,
  has_pages: false,
};

export function licenseFixture(overrides: Partial<License> = {}): License {
  return {
    id: 'lic_test123',
    status: 'active',
    customer: {
      id: 'cus_test',
      name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: null,
      avatar_url: null,
    },
    product: { id: 'prd_test', name: 'Pro License', type: 'license' },
    license: { key: 'ABCD-1234-EFGH-5678', masked_key: 'ABCD-****-****-5678' },
    is_active: true,
    is_expired: false,
    can_activate: true,
    activations: { count: 1, max: 3, remaining: 2 },
    certificate_url: null,
    metadata: null,
    activated_at: '2025-01-15T10:35:00+00:00',
    expires_at: null,
    expired_at: null,
    revoked_at: null,
    created_at: '2025-01-15T10:30:00+00:00',
    updated_at: '2025-01-15T10:35:00+00:00',
    ...overrides,
  };
}
