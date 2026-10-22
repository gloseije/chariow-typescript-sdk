import type { PaginationParams, ProductSimplified } from './common.js';

export type PulseTriggerValue =
  | 'all'
  | 'successful_sale'
  | 'abandoned_sale'
  | 'failed_sale'
  | 'license_activated'
  | 'license_expired'
  | 'license_issued'
  | 'license_nearing_expiry'
  | 'license_revoked'
  | 'affiliate_joined';

export interface PulseTrigger {
  value: PulseTriggerValue;
  label: string;
  description: string;
}

/** Pulse configuration, as returned by the read-only `/pulses` endpoints. */
export interface Pulse {
  id: string;
  url: string;
  /** Set to false automatically when a delivery fails all 5 attempts. */
  is_enabled: boolean;
  /** Masked signing secret (e.g. `whsec_••••a1b2`); the plaintext is never returned. */
  masked_secret: string | null;
  source: { value: 'manual' | 'zapier' | 'make' | 'n8n'; label: string; description: string };
  triggers: PulseTrigger[];
  /** Empty means every product. */
  products: ProductSimplified[];
  [key: string]: unknown;
}

export interface ListPulsesParams extends PaginationParams {
  search?: string;
}
