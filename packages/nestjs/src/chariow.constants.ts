/** Injection token of the core `Chariow` client. */
export const CHARIOW_CLIENT = Symbol('CHARIOW_CLIENT');
/** Injection token of the resolved module options. */
export const CHARIOW_MODULE_OPTIONS = Symbol('CHARIOW_MODULE_OPTIONS');
/** Injection token of the shared `PulseEventProcessor`. */
export const CHARIOW_PULSE_PROCESSOR = Symbol('CHARIOW_PULSE_PROCESSOR');
/** Request property where `ChariowPulseGuard` stores the verified event. */
export const CHARIOW_PULSE_EVENT_PROPERTY = 'chariowPulseEvent';
