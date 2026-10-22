import type { Country, CustomerSimplified, PaginationParams, ProductSimplified, UnknownRecord } from './common.js';

export type LicenseStatus = 'pending_activation' | 'active' | 'expired' | 'revoked';

/** License returned by the `/licenses` endpoints. */
export interface License {
  id: string;
  status: LicenseStatus;
  customer: CustomerSimplified;
  product: ProductSimplified;
  license: {
    /** Full license key. Treat it as a secret on the client side. */
    key: string;
    masked_key: string;
  };
  is_active: boolean;
  is_expired: boolean;
  can_activate: boolean;
  activations: {
    count: number;
    max: number;
    remaining: number;
  };
  /** Certificate download URL (Chariow documents a 30-minute validity). */
  certificate_url: string | null;
  metadata: UnknownRecord | null;
  activated_at: string | null;
  expires_at: string | null;
  expired_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activation {
  id: string;
  activated_by: {
    ip: {
      value: string;
      country: Country | null;
    };
    user_agent: {
      browser: string;
      platform: string;
      version: string;
      device: string;
      is_desktop: boolean;
      is_mobile: boolean;
      is_phone: boolean;
      is_tablet: boolean;
      is_robot: boolean;
      is_ios: boolean;
      is_android: boolean;
    } | null;
    /** The `device_identifier` sent on activation. */
    device: string | null;
  };
  metadata: UnknownRecord | null;
  activated_at: string;
  created_at: string;
}

export interface ListLicensesParams extends PaginationParams {
  status?: LicenseStatus;
  product_id?: string;
  search?: string;
}

export interface ActivateLicenseParams {
  /** Optional device identifier (max 255 characters), shown in the activation history. */
  device_identifier?: string;
}

export interface RevokeLicenseParams {
  /** Optional reason (max 500 characters). Chariow documents that it is not stored. */
  reason?: string;
}

/** Result of `POST /licenses/{key}/activate` and `POST /licenses/{key}/revoke`. */
export interface LicenseMutationResult {
  /** Confirmation message returned next to `data`. */
  message: string | null;
  license: License;
}

export type LicenseInvalidReason = 'not_found' | 'revoked' | 'expired' | 'pending_activation' | 'inactive';

/** Outcome of `licenses.validate()`, computed from the documented license fields. */
export type LicenseValidationResult =
  | { valid: true; license: License }
  | { valid: false; reason: LicenseInvalidReason; license: License | null };
