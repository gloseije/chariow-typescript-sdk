import { ChariowInvalidRequestError, ChariowNotFoundError } from '../errors/index.js';
import { type HttpClient, type RequestOptions, unwrapData, unwrapList } from '../http/http-client.js';
import { paginate } from '../pagination.js';
import type { ListResult, Pagination, PaginationParams } from '../types/common.js';
import type {
  ActivateLicenseParams,
  Activation,
  License,
  LicenseMutationResult,
  LicenseValidationResult,
  ListLicensesParams,
  RevokeLicenseParams,
} from '../types/licenses.js';
import { encodePathSegment, isRecord } from '../utils.js';

const MAX_DEVICE_IDENTIFIER_LENGTH = 255;
const MAX_REVOKE_REASON_LENGTH = 500;
const REDACTED = '/licenses/{licenseKey}';

/**
 * License endpoints. Read operations need the `licenses.read` scope,
 * `activate` and `revoke` need `licenses.write`.
 */
export class LicensesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** `GET /licenses` */
  async list(params: ListLicensesParams = {}, options: RequestOptions = {}): Promise<ListResult<License>> {
    const response = await this.#http.request({ ...options, method: 'GET', path: '/licenses', query: { ...params } });
    return unwrapList<License, Pagination>(response, 'GET /licenses');
  }

  /** Iterates over every license matching the filters, following the cursors. */
  listAll(params: Omit<ListLicensesParams, 'cursor'> = {}, options: RequestOptions = {}): AsyncGenerator<License, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /** `GET /licenses/{licenseKey}` — accepts a license key or a license public ID. */
  async get(licenseKey: string, options: RequestOptions = {}): Promise<License> {
    const response = await this.#http.request({
      ...options,
      method: 'GET',
      path: licensePath(licenseKey),
      redactedPath: REDACTED,
    });
    return unwrapData<License>(response, `GET ${REDACTED}`);
  }

  /**
   * Checks whether a license is currently usable, following the validation flow documented by
   * Chariow (read the license, then rely on `is_active` / `is_expired` / `status`).
   * A 404 is reported as `{ valid: false, reason: 'not_found' }`; other errors are thrown.
   */
  async validate(licenseKey: string, options: RequestOptions = {}): Promise<LicenseValidationResult> {
    let license: License;
    try {
      license = await this.get(licenseKey, options);
    } catch (error) {
      if (error instanceof ChariowNotFoundError) return { valid: false, reason: 'not_found', license: null };
      throw error;
    }
    return evaluateLicense(license);
  }

  /**
   * `POST /licenses/{licenseKey}/activate`. Chariow answers 400 when the license is revoked,
   * expired, out of activation slots, or already active on a product that does not require activation.
   */
  async activate(
    licenseKey: string,
    params: ActivateLicenseParams = {},
    options: RequestOptions = {},
  ): Promise<LicenseMutationResult> {
    if (
      params.device_identifier !== undefined &&
      params.device_identifier.length > MAX_DEVICE_IDENTIFIER_LENGTH
    ) {
      throw new ChariowInvalidRequestError([
        `device_identifier must be at most ${MAX_DEVICE_IDENTIFIER_LENGTH} characters`,
      ]);
    }
    const response = await this.#http.request({
      ...options,
      method: 'POST',
      path: `${licensePath(licenseKey)}/activate`,
      redactedPath: `${REDACTED}/activate`,
      body: params,
    });
    return toMutationResult(response.body, unwrapData<License>(response, `POST ${REDACTED}/activate`));
  }

  /** `POST /licenses/{licenseKey}/revoke`. Revocation is permanent. */
  async revoke(
    licenseKey: string,
    params: RevokeLicenseParams = {},
    options: RequestOptions = {},
  ): Promise<LicenseMutationResult> {
    if (params.reason !== undefined && params.reason.length > MAX_REVOKE_REASON_LENGTH) {
      throw new ChariowInvalidRequestError([`reason must be at most ${MAX_REVOKE_REASON_LENGTH} characters`]);
    }
    const response = await this.#http.request({
      ...options,
      method: 'POST',
      path: `${licensePath(licenseKey)}/revoke`,
      redactedPath: `${REDACTED}/revoke`,
      body: params,
    });
    return toMutationResult(response.body, unwrapData<License>(response, `POST ${REDACTED}/revoke`));
  }

  /** `GET /licenses/{licenseKey}/activations` */
  async listActivations(
    licenseKey: string,
    params: PaginationParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Activation>> {
    const response = await this.#http.request({
      ...options,
      method: 'GET',
      path: `${licensePath(licenseKey)}/activations`,
      redactedPath: `${REDACTED}/activations`,
      query: { ...params },
    });
    return unwrapList<Activation, Pagination>(response, `GET ${REDACTED}/activations`);
  }

  listAllActivations(
    licenseKey: string,
    params: Omit<PaginationParams, 'cursor'> = {},
    options: RequestOptions = {},
  ): AsyncGenerator<Activation, void, undefined> {
    return paginate((cursor) => this.listActivations(licenseKey, { ...params, cursor }, options));
  }
}

/** Derives a validation result from the documented license fields. */
export function evaluateLicense(license: License): LicenseValidationResult {
  if (license.status === 'revoked' || license.revoked_at !== null) {
    return { valid: false, reason: 'revoked', license };
  }
  if (license.is_expired || license.status === 'expired') {
    return { valid: false, reason: 'expired', license };
  }
  if (license.status === 'pending_activation') {
    return { valid: false, reason: 'pending_activation', license };
  }
  if (!license.is_active) {
    return { valid: false, reason: 'inactive', license };
  }
  return { valid: true, license };
}

function licensePath(licenseKey: string): string {
  if (licenseKey.trim() === '') throw new ChariowInvalidRequestError(['licenseKey is required']);
  return `/licenses/${encodePathSegment(licenseKey)}`;
}

function toMutationResult(body: unknown, license: License): LicenseMutationResult {
  const message = isRecord(body) && typeof body.message === 'string' ? body.message : null;
  return { message, license };
}
