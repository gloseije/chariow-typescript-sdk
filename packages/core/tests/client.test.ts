import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Chariow, ChariowConfigurationError, DEFAULT_BASE_URL } from '../src/index.js';
import { createFetchMock, jsonResponse, TEST_API_KEY, TEST_PULSE_SECRET } from './helpers.js';

describe('Chariow client configuration', () => {
  it('uses the documented production base URL by default', () => {
    const chariow = new Chariow({ apiKey: TEST_API_KEY });
    expect(chariow.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe('https://api.chariow.com/v1');
    expect(chariow.timeoutMs).toBe(30_000);
  });

  it.each([undefined, '', '   '])('rejects a missing API key (%j)', (apiKey) => {
    expect(() => new Chariow({ apiKey: apiKey as string })).toThrow(ChariowConfigurationError);
  });

  it('rejects an API key containing whitespace without echoing it', () => {
    const run = () => new Chariow({ apiKey: 'sk_abc def' });
    expect(run).toThrow(ChariowConfigurationError);
    expect(run).not.toThrow(/sk_abc/);
  });

  it('rejects non-HTTPS base URLs except loopback', () => {
    expect(() => new Chariow({ apiKey: TEST_API_KEY, baseUrl: 'http://api.chariow.com/v1' })).toThrow(
      ChariowConfigurationError,
    );
    expect(() => new Chariow({ apiKey: TEST_API_KEY, baseUrl: 'not a url' })).toThrow(ChariowConfigurationError);
    expect(() => new Chariow({ apiKey: TEST_API_KEY, baseUrl: 'https://x.test/v1?debug=1' })).toThrow(
      ChariowConfigurationError,
    );
    expect(new Chariow({ apiKey: TEST_API_KEY, baseUrl: 'http://127.0.0.1:4010/v1/' }).baseUrl).toBe(
      'http://127.0.0.1:4010/v1',
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => new Chariow({ apiKey: TEST_API_KEY, timeoutMs })).toThrow(ChariowConfigurationError);
  });

  it('never exposes the API key through serialization or inspection', () => {
    const chariow = new Chariow({ apiKey: TEST_API_KEY, pulseSecret: TEST_PULSE_SECRET });
    expect(JSON.stringify(chariow)).not.toContain(TEST_API_KEY);
    expect(inspect(chariow, { depth: 10 })).not.toContain(TEST_API_KEY);
    expect(inspect(chariow, { depth: 10 })).not.toContain(TEST_PULSE_SECRET);
  });

  it('requires pulseSecret to access webhooks', () => {
    const chariow = new Chariow({ apiKey: TEST_API_KEY });
    expect(() => chariow.webhooks).toThrow(ChariowConfigurationError);
    expect(() => new Chariow({ apiKey: TEST_API_KEY, pulseSecret: [] })).toThrow(ChariowConfigurationError);
    expect(new Chariow({ apiKey: TEST_API_KEY, pulseSecret: TEST_PULSE_SECRET }).webhooks).toBeDefined();
  });

  it('exposes a low-level request() for documented but unwrapped endpoints', async () => {
    const { fetch, calls } = createFetchMock(jsonResponse({ data: { id: 'store_1' } }));
    const chariow = new Chariow({ apiKey: TEST_API_KEY, fetch });
    const response = await chariow.request({ method: 'GET', path: '/store' });
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/store');
    expect(response.body).toEqual({ data: { id: 'store_1' } });
  });
});
