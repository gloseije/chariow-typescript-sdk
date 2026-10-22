import type { Amount, CustomerSimplified, LabelledValue, PaginationParams, ProductSimplified, UnknownRecord } from './common.js';

export type SaleStatus = 'initiated' | 'awaiting_payment' | 'completed' | 'failed' | 'abandoned' | 'settled';

export type SalePaymentStatus = 'initiated' | 'pending' | 'cancelled' | 'failed' | 'success';

export interface SaleShipping {
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
}

export interface SaleBuyer {
  first_name: string | null;
  last_name: string | null;
}

export interface SalePaymentFailure {
  code: string;
  customer_message: string;
}

/** Sale returned by `GET /sales` and as `purchase` in the checkout response. */
export interface SaleSummary {
  id: string;
  status: SaleStatus;
  tracking?: { event_id: string; currency: string; value: number };
  original_amount: Amount;
  amount: Amount;
  discount_amount: Amount;
  payment?: {
    amount?: Amount;
    status: SalePaymentStatus | null;
    exchange_rate?: Amount;
    failure_error?: SalePaymentFailure | null;
  };
  shipping?: SaleShipping;
  invoice_download_url: string | null;
  created_at: string;
  completed_at: string | null;
  store?: UnknownRecord;
  product?: ProductSimplified;
  customer?: CustomerSimplified;
  buyer?: SaleBuyer;
  discount?: UnknownRecord | null;
  rate?: { id: string; is_thumbs_up: boolean; comment: string | null; created_at: string } | null;
  gift?: { recipient: CustomerSimplified; message: string | null };
}

/** Sale returned by `GET /sales/{saleId}`. Nested objects not detailed by the docs are typed loosely. */
export interface SaleDetail {
  id: string;
  status: SaleStatus;
  channel?: LabelledValue;
  amount: Amount;
  original_amount: Amount;
  discount_amount: Amount;
  settlement?: UnknownRecord;
  download?: UnknownRecord;
  invoice_download_url: string | null;
  payment?: {
    status?: SalePaymentStatus | null;
    amount?: Amount;
    transaction_id?: string | null;
    gateway?: unknown;
    method?: unknown;
    failure_error?: SalePaymentFailure | null;
    [key: string]: unknown;
  };
  shipping?: SaleShipping;
  context?: UnknownRecord;
  custom_fields_values?: UnknownRecord;
  campaign?: { id: string; name: string } | null;
  rating?: UnknownRecord | null;
  store?: UnknownRecord;
  product?: ProductSimplified;
  customer?: CustomerSimplified;
  buyer?: SaleBuyer;
  discount?: UnknownRecord | null;
  gift?: UnknownRecord;
  is_access_revoked?: boolean;
  is_reconciled?: boolean;
  last_reconciled_at?: string | null;
  failed_at: string | null;
  awaiting_payment_at?: string | null;
  abandoned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SalePeriod =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear';

export interface ListSalesParams extends PaginationParams {
  status?: SaleStatus;
  customer_id?: string;
  search?: string;
  /** Date (YYYY-MM-DD). */
  from?: string;
  /** Date (YYYY-MM-DD). */
  to?: string;
  period?: SalePeriod;
}
