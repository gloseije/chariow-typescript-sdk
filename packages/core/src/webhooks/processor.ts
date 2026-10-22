import type { KnownPulseEventName, PulseEvent, PulseEventOfType, UnknownPulseEvent } from './events.js';

/**
 * Stores processed `x-pulse-delivery-id` values. Implement it on top of a shared
 * store (database unique constraint, Redis `SET NX`...) when running several instances.
 */
export interface PulseIdempotencyStore {
  /** Atomically records the delivery. Returns `false` when it was already recorded. */
  claim(deliveryId: string): boolean | Promise<boolean>;
  /** Forgets a delivery whose processing failed, so that Chariow's retry is processed. */
  release(deliveryId: string): void | Promise<void>;
}

export interface InMemoryPulseIdempotencyStoreOptions {
  /** How long a delivery ID is remembered. Default: 24 h (Chariow retries span about 3 h). */
  ttlMs?: number;
  /** Maximum number of remembered IDs. Default: 10 000. */
  maxEntries?: number;
}

/** Process-local store, suitable for a single instance or for tests. */
export class InMemoryPulseIdempotencyStore implements PulseIdempotencyStore {
  readonly #entries = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(options: InMemoryPulseIdempotencyStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.#maxEntries = options.maxEntries ?? 10_000;
  }

  claim(deliveryId: string): boolean {
    const now = Date.now();
    this.#evict(now);
    const expiresAt = this.#entries.get(deliveryId);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.#entries.set(deliveryId, now + this.#ttlMs);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return true;
  }

  release(deliveryId: string): void {
    this.#entries.delete(deliveryId);
  }

  get size(): number {
    return this.#entries.size;
  }

  #evict(now: number): void {
    for (const [id, expiresAt] of this.#entries) {
      if (expiresAt > now) break;
      this.#entries.delete(id);
    }
  }
}

export type PulseEventHandler<E extends PulseEvent = PulseEvent> = (event: E) => void | Promise<void>;

export type PulseProcessStatus = 'processed' | 'duplicate' | 'unhandled';

export interface PulseProcessResult {
  status: PulseProcessStatus;
  /** Number of handlers invoked. */
  handlers: number;
}

export interface PulseEventProcessorOptions {
  /** Enables deduplication on `x-pulse-delivery-id`. */
  idempotencyStore?: PulseIdempotencyStore;
}

/**
 * Dispatches verified Pulse events to handlers, with optional deduplication.
 * Handler errors are re-thrown (after releasing the delivery ID) so that your endpoint
 * answers with an error status and Chariow retries the delivery.
 */
export class PulseEventProcessor {
  readonly #handlers = new Map<string, PulseEventHandler[]>();
  readonly #unknownHandlers: PulseEventHandler<UnknownPulseEvent>[] = [];
  readonly #anyHandlers: PulseEventHandler[] = [];
  readonly #store: PulseIdempotencyStore | undefined;

  constructor(options: PulseEventProcessorOptions = {}) {
    this.#store = options.idempotencyStore;
  }

  on<E extends KnownPulseEventName>(type: E, handler: PulseEventHandler<PulseEventOfType<E>>): this {
    const list = this.#handlers.get(type) ?? [];
    list.push(handler as PulseEventHandler);
    this.#handlers.set(type, list);
    return this;
  }

  /** Handles events whose name is not documented by Chariow. */
  onUnknown(handler: PulseEventHandler<UnknownPulseEvent>): this {
    this.#unknownHandlers.push(handler);
    return this;
  }

  /** Handles every event, known or unknown. */
  onAny(handler: PulseEventHandler): this {
    this.#anyHandlers.push(handler);
    return this;
  }

  async process(event: PulseEvent): Promise<PulseProcessResult> {
    const deliveryId = event.deliveryId;
    if (this.#store && deliveryId) {
      const claimed = await this.#store.claim(deliveryId);
      if (!claimed) return { status: 'duplicate', handlers: 0 };
    }

    const handlers: PulseEventHandler[] = [
      ...(event.known ? (this.#handlers.get(event.type) ?? []) : (this.#unknownHandlers as PulseEventHandler[])),
      ...this.#anyHandlers,
    ];

    try {
      for (const handler of handlers) await handler(event);
    } catch (error) {
      if (this.#store && deliveryId) await this.#store.release(deliveryId);
      throw error;
    }
    return { status: handlers.length > 0 ? 'processed' : 'unhandled', handlers: handlers.length };
  }
}
