import type { Amount, Country, UnknownRecord } from '../types/common.js';

/** Event names documented by Chariow (`/en/guides/pulses`). */
export const KNOWN_PULSE_EVENTS = [
  'successful.sale',
  'abandoned.sale',
  'failed.sale',
  'license.activated',
  'license.expired',
  'license.issued',
  'license.nearing_expiry',
  'license.revoked',
  'affiliate.joined',
] as const;

export type KnownPulseEventName = (typeof KNOWN_PULSE_EVENTS)[number];

export function isKnownPulseEventName(value: string): value is KnownPulseEventName {
  return (KNOWN_PULSE_EVENTS as readonly string[]).includes(value);
}

export interface PulseStore {
  id: string;
  name: string;
  url: string;
}

export interface PulseCustomer {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  country: string | null;
}

export interface PulseProduct {
  id: string;
  name: string;
  url: string;
  metadata: UnknownRecord | null;
  price?: Amount;
}

export interface PulseSale {
  id: string;
  amount: Amount;
  original_amount: Amount;
  discount_amount: Amount;
  settlement?: UnknownRecord;
  status: string;
  created_at: string;
  custom_fields: unknown;
  /** `custom_metadata` sent with `POST /checkout`. */
  custom_metadata: Record<string, string> | null;
  completed_at: string | null;
  abandoned_at: string | null;
  failed_at: string | null;
}

export interface PulseLicense {
  id: string;
  /** Full license key. */
  key: string;
  status: string;
  source_type: string;
  activation_count: number;
  max_activations: number;
  activated_at: string | null;
  expires_at: string | null;
  expired_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PulseAffiliate {
  id: string;
  account: {
    id: string;
    code: string;
    pseudo: string;
    email: string;
    first_name: string;
    last_name: string;
    name: string;
    country: Country | null;
    phone: { number: number; country: Country } | null;
  } | null;
  source: { value: string; label: string; description: string };
  status: string;
  joined_at: string;
}

interface PulsePayloadBase<E extends string> {
  event: E;
  /** Chariow warns that payloads may carry additional fields. */
  [key: string]: unknown;
}

/** Documented `successful.sale` payload. */
export interface SalePulsePayload<E extends string = 'successful.sale'> extends PulsePayloadBase<E> {
  sale: PulseSale;
  product: PulseProduct;
  customer: PulseCustomer;
  /** `null` unless the sale came through an affiliate. */
  affiliate: { id: string; code: string } | null;
  store: PulseStore;
  checkout?: { url: string };
}

/** Documented `license.activated` payload. */
export interface LicensePulsePayload<E extends string = 'license.activated'> extends PulsePayloadBase<E> {
  license: PulseLicense;
  product: PulseProduct;
  customer: PulseCustomer;
  store: PulseStore;
}

/** Documented `license.nearing_expiry` payload. */
export interface LicenseNearingExpiryPulsePayload extends LicensePulsePayload<'license.nearing_expiry'> {
  /** Rounded up number of days before `license.expires_at`. */
  days_until_expiry: number;
}

/** Documented `affiliate.joined` payload. */
export interface AffiliateJoinedPulsePayload extends PulsePayloadBase<'affiliate.joined'> {
  affiliate: PulseAffiliate;
  store: PulseStore;
}

/**
 * Payload of an event whose exact structure is NOT documented by Chariow
 * (`abandoned.sale`, `failed.sale`, `license.issued`, `license.expired`, `license.revoked`).
 * Fields are modelled after the documented event of the same family and are all optional:
 * check them before use.
 */
export type UndocumentedPulsePayload<E extends string, P> = PulsePayloadBase<E> & Partial<Omit<P, 'event'>>;

export interface PulsePayloadMap {
  'successful.sale': SalePulsePayload;
  'abandoned.sale': UndocumentedPulsePayload<'abandoned.sale', SalePulsePayload<'abandoned.sale'>>;
  'failed.sale': UndocumentedPulsePayload<'failed.sale', SalePulsePayload<'failed.sale'>>;
  'license.activated': LicensePulsePayload;
  'license.expired': UndocumentedPulsePayload<'license.expired', LicensePulsePayload<'license.expired'>>;
  'license.issued': UndocumentedPulsePayload<'license.issued', LicensePulsePayload<'license.issued'>>;
  'license.nearing_expiry': LicenseNearingExpiryPulsePayload;
  'license.revoked': UndocumentedPulsePayload<'license.revoked', LicensePulsePayload<'license.revoked'>>;
  'affiliate.joined': AffiliateJoinedPulsePayload;
}

/** Delivery metadata taken from the Pulse request headers. */
export interface PulseDeliveryMetadata {
  /** `x-pulse-delivery-id` — stable across retries, use it as idempotency key. */
  deliveryId: string | null;
  /** `x-pulse-id` */
  pulseId: string | null;
  /** `x-pulse-event` */
  eventHeader: string | null;
}

export type KnownPulseEvent = {
  [E in KnownPulseEventName]: PulseDeliveryMetadata & { known: true; type: E; payload: PulsePayloadMap[E] };
}[KnownPulseEventName];

/** Event not (yet) documented by Chariow: delivered as-is instead of failing. */
export interface UnknownPulseEvent extends PulseDeliveryMetadata {
  known: false;
  type: string;
  payload: PulsePayloadBase<string>;
}

export type PulseEvent = KnownPulseEvent | UnknownPulseEvent;

export type PulseEventOfType<E extends KnownPulseEventName> = Extract<KnownPulseEvent, { type: E }>;
