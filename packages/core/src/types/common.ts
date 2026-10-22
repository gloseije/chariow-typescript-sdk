/** Cursor pagination metadata returned next to `data` by every list endpoint. */
export interface Pagination {
  count: number;
  path: string;
  per_page: number;
  next_cursor: string | null;
  next_page_url: string | null;
  prev_cursor: string | null;
  prev_page_url: string | null;
  has_more_pages: boolean;
  has_pages: boolean;
}

/** Documented pagination query parameters. */
export interface PaginationParams {
  /** Items per page (Chariow default 10, maximum 100). */
  per_page?: number;
  /** Cursor returned in `pagination.next_cursor` / `prev_cursor`. */
  cursor?: string;
}

export interface ListResult<T> {
  data: T[];
  pagination: Pagination;
}

export interface Amount {
  value: number;
  formatted: string;
  short: string;
  currency: string;
}

export interface NullableAmount {
  value: number | null;
  formatted: string | null;
  short: string | null;
  currency: string | null;
}

export interface Country {
  name: string;
  code: string;
  alpha_3_code: string;
  dial_code: string;
  currency: string;
  flag: string;
}

/** Labelled enum value as returned by Chariow (`{ value, label, description }`). */
export interface LabelledValue<V extends string = string> {
  value: V;
  label: string;
  description?: string;
}

/** Object whose structure is not fully described by the documentation. */
export type UnknownRecord = Record<string, unknown>;

export type ProductType = 'downloadable' | 'course' | 'license' | 'service' | 'bundle' | 'coaching';

export interface CustomerSimplified {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: {
    number: string;
    country: Country;
  } | null;
  avatar_url: string | null;
}

export interface ProductSimplified {
  id: string;
  name: string;
  type: ProductType;
  pictures?: { thumbnail: string | null; cover: string | null };
  category?: { value: string; label: string };
  pricing?: {
    type: string;
    price?: NullableAmount;
    effective?: NullableAmount;
  };
  bundle?: UnknownRecord;
  metadata?: UnknownRecord | null;
}
