import type { SaleSummary } from './sales.js';

export interface CheckoutPhone {
  /** Phone number without the country prefix. */
  number: string;
  /** ISO 3166-1 alpha-2 country code. */
  country_code: string;
}

export interface CheckoutShipping {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
}

export interface CheckoutGift {
  recipient_email: string;
  recipient_first_name: string;
  recipient_last_name: string;
  message?: string;
}

/** Body of `POST /checkout`. Field names follow the Chariow API exactly. */
export interface CheckoutRequest {
  /** Product public ID or slug. The product must be published. */
  product_id: string;
  email: string;
  /** Max 50 characters. */
  first_name: string;
  /** Max 50 characters. */
  last_name: string;
  phone: CheckoutPhone;
  price_variant_id?: string;
  discount_code?: string;
  affiliate_code?: string;
  payment_currency?: string;
  campaign_id?: string;
  custom_fields?: Record<string, unknown>;
  /** Where the buyer is sent after payment (max 2048 characters). UX only: never a payment proof. */
  redirect_url?: string;
  /** Up to 10 keys, string values up to 255 characters. Echoed in sale Pulse payloads. */
  custom_metadata?: Record<string, string>;
  customer_ip?: string;
  shipping?: CheckoutShipping;
  /** Up to 4 canonical HTTPS origins allowed to embed the checkout. */
  embed_origins?: string[];
  gift?: CheckoutGift;
}

export type CheckoutStep = 'payment' | 'completed' | 'already_purchased';

/** `data` of the `POST /checkout` response. */
export interface CheckoutSession {
  /**
   * `payment`: redirect the buyer to `payment.checkout_url`;
   * `completed`: nothing to pay (free product or 100% discount);
   * `already_purchased`: no sale was created.
   */
  step: CheckoutStep;
  message: string | null;
  purchase: SaleSummary | null;
  payment: {
    checkout_url: string | null;
    transaction_id: string | null;
    gateway: string | null;
  };
}
