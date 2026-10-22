import { describe, expect, it } from 'vitest';
import { Chariow, ChariowInvalidRequestError, ChariowResponseError } from '../src/index.js';
import { createFetchMock, jsonResponse, paginationFixture, TEST_API_KEY } from './helpers.js';

describe('sales', () => {
  it('gets a sale by id', async () => {
    const { fetch, calls } = createFetchMock(jsonResponse({ data: { id: 'sal_1', status: 'completed' } }));
    const sale = await new Chariow({ apiKey: TEST_API_KEY, fetch }).sales.get('sal_1');
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/sales/sal_1');
    expect(sale.status).toBe('completed');
  });

  it('rejects an empty sale id', async () => {
    const { fetch } = createFetchMock();
    await expect(new Chariow({ apiKey: TEST_API_KEY, fetch }).sales.get('')).rejects.toBeInstanceOf(
      ChariowInvalidRequestError,
    );
  });

  it('rejects list responses without pagination', async () => {
    const { fetch } = createFetchMock(jsonResponse({ data: [] }));
    await expect(new Chariow({ apiKey: TEST_API_KEY, fetch }).sales.list()).rejects.toBeInstanceOf(
      ChariowResponseError,
    );
  });
});

describe('pulses (read-only)', () => {
  const pulse = {
    id: 'pulse_abc',
    url: 'https://app.example.com/webhooks/chariow',
    is_enabled: true,
    masked_secret: 'whsec_••••a1b2',
    source: { value: 'manual', label: 'Manual', description: 'Created manually' },
    triggers: [{ value: 'successful_sale', label: 'Successful Sale', description: '' }],
    products: [],
  };

  it('lists pulses with search', async () => {
    const { fetch, calls } = createFetchMock(jsonResponse({ data: [pulse], pagination: paginationFixture }));
    const result = await new Chariow({ apiKey: TEST_API_KEY, fetch }).pulses.list({ search: 'example' });
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/pulses?search=example');
    expect(result.data[0]?.masked_secret).toBe('whsec_••••a1b2');
  });

  it('gets a pulse', async () => {
    const { fetch, calls } = createFetchMock(jsonResponse({ data: pulse }));
    const result = await new Chariow({ apiKey: TEST_API_KEY, fetch }).pulses.get('pulse_abc');
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/pulses/pulse_abc');
    expect(result.is_enabled).toBe(true);
  });
});
