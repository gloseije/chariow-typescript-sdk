import { Inject, Injectable } from '@nestjs/common';
import {
  type ActivateLicenseParams,
  Chariow,
  type CheckoutRequest,
  type CheckoutSession,
  getCheckoutUrl,
  type KnownPulseEventName,
  type LicenseMutationResult,
  type LicenseValidationResult,
  type PulseEvent,
  type PulseEventHandler,
  type PulseEventOfType,
  PulseEventProcessor,
  type PulseHeaders,
  type PulseProcessResult,
  type PulseRawBody,
  type RequestOptions,
  type SaleDetail,
  type UnknownPulseEvent,
} from '@gloseije/chariow-sdk';
import { CHARIOW_CLIENT, CHARIOW_PULSE_PROCESSOR } from './chariow.constants.js';

export interface CheckoutResult {
  session: CheckoutSession;
  /** Hosted payment page when `session.step === 'payment'`, otherwise `null`. */
  checkoutUrl: string | null;
}

export interface SalePaymentStatus {
  sale: SaleDetail;
  /** `true` when Chariow reports the sale as `completed` or `settled`. */
  paid: boolean;
}

export interface HandledPulse extends PulseProcessResult {
  event: PulseEvent;
}

/** NestJS facade over the core `Chariow` client. All HTTP calls are performed by the core SDK. */
@Injectable()
export class ChariowService {
  constructor(
    @Inject(CHARIOW_CLIENT) readonly client: Chariow,
    @Inject(CHARIOW_PULSE_PROCESSOR) readonly pulseProcessor: PulseEventProcessor,
  ) {}

  get checkout(): Chariow['checkout'] {
    return this.client.checkout;
  }

  get licenses(): Chariow['licenses'] {
    return this.client.licenses;
  }

  get sales(): Chariow['sales'] {
    return this.client.sales;
  }

  get pulses(): Chariow['pulses'] {
    return this.client.pulses;
  }

  /** Starts a checkout and extracts the payment URL. Never treat the redirect as a payment proof. */
  async createCheckout(params: CheckoutRequest, options?: RequestOptions): Promise<CheckoutResult> {
    const session = await this.client.checkout.create(params, options);
    return { session, checkoutUrl: getCheckoutUrl(session) };
  }

  /** Reads a sale from the API (server-side source of truth) and tells whether it is paid. */
  async getSalePaymentStatus(saleId: string, options?: RequestOptions): Promise<SalePaymentStatus> {
    const sale = await this.client.sales.get(saleId, options);
    return { sale, paid: sale.status === 'completed' || sale.status === 'settled' };
  }

  validateLicense(licenseKey: string, options?: RequestOptions): Promise<LicenseValidationResult> {
    return this.client.licenses.validate(licenseKey, options);
  }

  activateLicense(
    licenseKey: string,
    params?: ActivateLicenseParams,
    options?: RequestOptions,
  ): Promise<LicenseMutationResult> {
    return this.client.licenses.activate(licenseKey, params, options);
  }

  revokeLicense(licenseKey: string, reason?: string, options?: RequestOptions): Promise<LicenseMutationResult> {
    return this.client.licenses.revoke(licenseKey, reason === undefined ? {} : { reason }, options);
  }

  /** Verifies the signature of a Pulse delivery and parses it. Requires `pulseSecret`. */
  constructPulseEvent(rawBody: PulseRawBody, headers: PulseHeaders): PulseEvent {
    return this.client.webhooks.constructEvent({ rawBody, headers });
  }

  /** Registers a handler for a documented Pulse event. */
  onPulse<E extends KnownPulseEventName>(type: E, handler: PulseEventHandler<PulseEventOfType<E>>): this {
    this.pulseProcessor.on(type, handler);
    return this;
  }

  /** Registers a handler for undocumented event names. */
  onUnknownPulse(handler: PulseEventHandler<UnknownPulseEvent>): this {
    this.pulseProcessor.onUnknown(handler);
    return this;
  }

  /** Dispatches an already verified event (deduplicated on `x-pulse-delivery-id`). */
  dispatchPulse(event: PulseEvent): Promise<PulseProcessResult> {
    return this.pulseProcessor.process(event);
  }

  /** Verifies, parses and dispatches a Pulse delivery in one call. */
  async handlePulse(rawBody: PulseRawBody, headers: PulseHeaders): Promise<HandledPulse> {
    const event = this.constructPulseEvent(rawBody, headers);
    const result = await this.dispatchPulse(event);
    return { ...result, event };
  }
}
