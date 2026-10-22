import { describe, expect, it } from 'vitest';
import {
  Chariow,
  ChariowBadRequestError,
  ChariowInvalidRequestError,
  ChariowServerError,
  evaluateLicense,
} from '../src/index.js';
import {
  bodyOf,
  createFetchMock,
  jsonResponse,
  licenseFixture,
  paginationFixture,
  TEST_API_KEY,
} from './helpers.js';

function setup(...responses: Response[]) {
  const mock = createFetchMock(...responses);
  return { ...mock, chariow: new Chariow({ apiKey: TEST_API_KEY, fetch: mock.fetch }) };
}

describe('licenses', () => {
  it('gets a license by key, URL-encoding the key', async () => {
    const { chariow, calls } = setup(jsonResponse({ data: licenseFixture() }));
    const license = await chariow.licenses.get('AB/CD 12');
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/licenses/AB%2FCD%2012');
    expect(license.license.key).toBe('ABCD-1234-EFGH-5678');
  });

  it('rejects an empty license key locally', async () => {
    const { chariow, calls } = setup();
    await expect(chariow.licenses.get(' ')).rejects.toBeInstanceOf(ChariowInvalidRequestError);
    expect(calls).toHaveLength(0);
  });

  it('lists licenses with documented filters', async () => {
    const { chariow, calls } = setup(jsonResponse({ data: [licenseFixture()], pagination: paginationFixture }));
    const result = await chariow.licenses.list({ status: 'active', product_id: 'prd_test', per_page: 100 });
    expect(new URL(calls[0]!.url).search).toBe('?status=active&product_id=prd_test&per_page=100');
    expect(result.data).toHaveLength(1);
    expect(result.pagination.has_more_pages).toBe(false);
  });

  it('follows cursors with listAll', async () => {
    const { chariow, calls } = setup(
      jsonResponse({
        data: [licenseFixture({ id: 'lic_1' })],
        pagination: { ...paginationFixture, next_cursor: 'cur_2', has_more_pages: true },
      }),
      jsonResponse({ data: [licenseFixture({ id: 'lic_2' })], pagination: paginationFixture }),
    );
    const ids: string[] = [];
    for await (const license of chariow.licenses.listAll({ status: 'active' })) ids.push(license.id);
    expect(ids).toEqual(['lic_1', 'lic_2']);
    expect(new URL(calls[1]!.url).searchParams.get('cursor')).toBe('cur_2');
  });

  describe('validate', () => {
    it.each([
      [licenseFixture(), true, undefined],
      [licenseFixture({ status: 'revoked', is_active: false, revoked_at: '2025-02-01T00:00:00+00:00' }), false, 'revoked'],
      [licenseFixture({ status: 'expired', is_active: false, is_expired: true }), false, 'expired'],
      [licenseFixture({ status: 'pending_activation', is_active: false }), false, 'pending_activation'],
      [licenseFixture({ is_active: false }), false, 'inactive'],
    ])('evaluates documented license states', async (license, valid, reason) => {
      const { chariow } = setup(jsonResponse({ data: license }));
      const result = await chariow.licenses.validate('ABCD-1234-EFGH-5678');
      expect(result.valid).toBe(valid);
      if (!result.valid) expect(result.reason).toBe(reason);
      expect(evaluateLicense(license).valid).toBe(valid);
    });

    it('reports unknown keys as not_found', async () => {
      const { chariow } = setup(jsonResponse({ message: 'License not found', errors: [] }, 404));
      await expect(chariow.licenses.validate('UNKNOWN')).resolves.toEqual({
        valid: false,
        reason: 'not_found',
        license: null,
      });
    });

    it('rethrows other errors', async () => {
      const { chariow } = setup(jsonResponse({ message: 'Server Error' }, 500));
      await expect(chariow.licenses.validate('KEY')).rejects.toBeInstanceOf(ChariowServerError);
    });
  });

  it('activates a license with a device identifier', async () => {
    const { chariow, calls } = setup(
      jsonResponse({ message: 'License activated successfully', data: licenseFixture() }),
    );
    const result = await chariow.licenses.activate('ABCD-1234', { device_identifier: 'macbook-pro-01' });
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/licenses/ABCD-1234/activate');
    expect(calls[0]?.init.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ device_identifier: 'macbook-pro-01' });
    expect(result.message).toBe('License activated successfully');
    expect(result.license.is_active).toBe(true);
  });

  it('surfaces activation business errors (400)', async () => {
    const { chariow } = setup(jsonResponse({ message: 'Activation limit reached', data: [], errors: [] }, 400));
    await expect(chariow.licenses.activate('ABCD-1234')).rejects.toBeInstanceOf(ChariowBadRequestError);
  });

  it('rejects device identifiers over 255 characters', async () => {
    const { chariow } = setup();
    await expect(
      chariow.licenses.activate('ABCD', { device_identifier: 'x'.repeat(256) }),
    ).rejects.toBeInstanceOf(ChariowInvalidRequestError);
  });

  it('revokes a license with a reason', async () => {
    const { chariow, calls } = setup(
      jsonResponse({ message: 'License revoked', data: licenseFixture({ status: 'revoked', is_active: false }) }),
    );
    const result = await chariow.licenses.revoke('ABCD-1234', { reason: 'Refund' });
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/licenses/ABCD-1234/revoke');
    expect(bodyOf(calls[0])).toEqual({ reason: 'Refund' });
    expect(result.license.status).toBe('revoked');
  });

  it('rejects revocation reasons over 500 characters', async () => {
    const { chariow } = setup();
    await expect(chariow.licenses.revoke('ABCD', { reason: 'x'.repeat(501) })).rejects.toBeInstanceOf(
      ChariowInvalidRequestError,
    );
  });

  it('lists activations', async () => {
    const activation = {
      id: 'act_1',
      activated_by: { ip: { value: '203.0.113.1', country: null }, user_agent: null, device: 'macbook-pro-01' },
      metadata: null,
      activated_at: '2025-01-15T10:35:00+00:00',
      created_at: '2025-01-15T10:35:00+00:00',
    };
    const { chariow, calls } = setup(jsonResponse({ data: [activation], pagination: paginationFixture }));
    const result = await chariow.licenses.listActivations('ABCD-1234', { per_page: 5 });
    expect(calls[0]?.url).toBe('https://api.chariow.com/v1/licenses/ABCD-1234/activations?per_page=5');
    expect(result.data[0]?.activated_by.device).toBe('macbook-pro-01');
  });
});
