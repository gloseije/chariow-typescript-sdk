/** Base class of every error thrown by the SDK. */
export class ChariowError extends Error {
  override readonly name: string = 'ChariowError';
}

/** Invalid SDK configuration (missing API key, invalid base URL, invalid timeout...). */
export class ChariowConfigurationError extends ChariowError {
  override readonly name: string = 'ChariowConfigurationError';
}

/**
 * Request rejected locally, before any HTTP call, because it violates a constraint
 * documented by Chariow (required field, documented maximum length...).
 */
export class ChariowInvalidRequestError extends ChariowError {
  override readonly name: string = 'ChariowInvalidRequestError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid request: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

/** The request could not reach Chariow (DNS, TLS, connection reset...). */
export class ChariowNetworkError extends ChariowError {
  override readonly name: string = 'ChariowNetworkError';
}

/** The request exceeded the configured timeout. */
export class ChariowTimeoutError extends ChariowNetworkError {
  override readonly name: string = 'ChariowTimeoutError';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request to Chariow timed out after ${timeoutMs} ms`);
    this.timeoutMs = timeoutMs;
  }
}

/** The request was cancelled through the AbortSignal supplied by the caller. */
export class ChariowAbortError extends ChariowError {
  override readonly name: string = 'ChariowAbortError';
}

/** Chariow answered with a 2xx status but the body is not the documented JSON envelope. */
export class ChariowResponseError extends ChariowError {
  override readonly name: string = 'ChariowResponseError';
  readonly status: number;

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

/** Rate-limit headers documented for HTTP 429 responses. */
export interface ChariowRateLimitInfo {
  /** `Retry-After`, in seconds. */
  retryAfterSeconds: number | null;
  /** `X-RateLimit-Limit`. */
  limit: number | null;
  /** `X-RateLimit-Remaining`. */
  remaining: number | null;
  /** `X-RateLimit-Reset` (Unix timestamp, as sent by Chariow). */
  reset: number | null;
}

export interface ChariowApiErrorDetails {
  status: number;
  method: string;
  /** Request path with sensitive segments (license keys) replaced by placeholders. */
  path: string;
  /** `message` field of the error body (translated by Chariow, do not branch on it). */
  apiMessage: string | null;
  /** `errors` field of the error body, as returned by Chariow. */
  errors: unknown;
  /** `data` field of the error body, when present. */
  data: unknown;
}

/** Non-2xx HTTP response returned by the Chariow API. */
export class ChariowApiError extends ChariowError {
  override readonly name: string = 'ChariowApiError';
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly apiMessage: string | null;
  readonly errors: unknown;
  readonly data: unknown;

  constructor(details: ChariowApiErrorDetails) {
    const suffix = details.apiMessage ? `: ${details.apiMessage}` : '';
    super(`Chariow API responded ${details.status} to ${details.method} ${details.path}${suffix}`);
    this.status = details.status;
    this.method = details.method;
    this.path = details.path;
    this.apiMessage = details.apiMessage;
    this.errors = details.errors;
    this.data = details.data;
  }
}

/** HTTP 400 — business rule violation (e.g. license already revoked, activation limit reached). */
export class ChariowBadRequestError extends ChariowApiError {
  override readonly name: string = 'ChariowBadRequestError';
}

/** HTTP 401 — missing, invalid or revoked API key. */
export class ChariowAuthenticationError extends ChariowApiError {
  override readonly name: string = 'ChariowAuthenticationError';
}

/** HTTP 403 — the API key lacks one or more scopes, listed in `missingScopes`. */
export class ChariowPermissionError extends ChariowApiError {
  override readonly name: string = 'ChariowPermissionError';
  readonly missingScopes: readonly string[];

  constructor(details: ChariowApiErrorDetails) {
    super(details);
    this.missingScopes = extractScopes(details.errors);
  }
}

/** HTTP 404 — resource not found. */
export class ChariowNotFoundError extends ChariowApiError {
  override readonly name: string = 'ChariowNotFoundError';
}

/** HTTP 409 — conflict (documented for gift checkouts). */
export class ChariowConflictError extends ChariowApiError {
  override readonly name: string = 'ChariowConflictError';
}

/** HTTP 422 — validation failed; `fieldErrors` maps each field to its messages. */
export class ChariowValidationError extends ChariowApiError {
  override readonly name: string = 'ChariowValidationError';
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;

  constructor(details: ChariowApiErrorDetails) {
    super(details);
    this.fieldErrors = extractFieldErrors(details.errors);
  }
}

/** HTTP 429 — rate limit exceeded. */
export class ChariowRateLimitError extends ChariowApiError {
  override readonly name: string = 'ChariowRateLimitError';
  readonly rateLimit: ChariowRateLimitInfo;

  constructor(details: ChariowApiErrorDetails, rateLimit: ChariowRateLimitInfo) {
    super(details);
    this.rateLimit = rateLimit;
  }

  get retryAfterSeconds(): number | null {
    return this.rateLimit.retryAfterSeconds;
  }
}

/** HTTP 5xx — server-side error. */
export class ChariowServerError extends ChariowApiError {
  override readonly name: string = 'ChariowServerError';
}

export type ChariowWebhookVerificationFailure =
  | 'missing_secret'
  | 'missing_signature'
  | 'unsupported_scheme'
  | 'malformed_signature'
  | 'signature_mismatch';

/** A Pulse delivery failed signature verification. Respond with HTTP 401. */
export class ChariowWebhookVerificationError extends ChariowError {
  override readonly name: string = 'ChariowWebhookVerificationError';
  readonly reason: ChariowWebhookVerificationFailure;

  constructor(reason: ChariowWebhookVerificationFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** A correctly signed Pulse delivery whose body is not a valid event payload. */
export class ChariowWebhookPayloadError extends ChariowError {
  override readonly name: string = 'ChariowWebhookPayloadError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractScopes(errors: unknown): string[] {
  if (!isRecord(errors) || !Array.isArray(errors.scopes)) return [];
  return errors.scopes.filter((scope): scope is string => typeof scope === 'string');
}

function extractFieldErrors(errors: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!isRecord(errors)) return result;
  for (const [field, messages] of Object.entries(errors)) {
    if (Array.isArray(messages)) {
      result[field] = messages.filter((m): m is string => typeof m === 'string');
    } else if (typeof messages === 'string') {
      result[field] = [messages];
    }
  }
  return result;
}
