import type { ModuleMetadata, Provider, Type } from '@nestjs/common';
import type { ChariowOptions, PulseIdempotencyStore } from '@gloseije/chariow-sdk';

export interface ChariowModuleOptions extends ChariowOptions {
  /**
   * Store used to deduplicate Pulse deliveries on `x-pulse-delivery-id`.
   * Defaults to an in-memory store (single instance only). Pass `false` to disable deduplication.
   */
  idempotencyStore?: PulseIdempotencyStore | false;
}

export interface ChariowOptionsFactory {
  createChariowOptions(): ChariowModuleOptions | Promise<ChariowModuleOptions>;
}

export interface ChariowModuleRegistration {
  /** Registers the module globally (no need to import it in feature modules). */
  isGlobal?: boolean;
}

export type ChariowModuleForRootOptions = ChariowModuleOptions & ChariowModuleRegistration;

export interface ChariowModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'>, ChariowModuleRegistration {
  useFactory?: (...args: never[]) => ChariowModuleOptions | Promise<ChariowModuleOptions>;
  inject?: (string | symbol | Type | { token: string | symbol | Type; optional: boolean })[];
  useClass?: Type<ChariowOptionsFactory>;
  useExisting?: Type<ChariowOptionsFactory>;
  /** Additional providers made available to the factory / options class. */
  extraProviders?: Provider[];
}
