import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { Chariow, InMemoryPulseIdempotencyStore, PulseEventProcessor } from '@gloseije/chariow-sdk';
import { CHARIOW_CLIENT, CHARIOW_MODULE_OPTIONS, CHARIOW_PULSE_PROCESSOR } from './chariow.constants.js';
import type {
  ChariowModuleAsyncOptions,
  ChariowModuleForRootOptions,
  ChariowModuleOptions,
  ChariowOptionsFactory,
} from './chariow.options.js';
import { ChariowPulseGuard } from './chariow-pulse.guard.js';
import { ChariowService } from './chariow.service.js';

const sharedProviders: Provider[] = [
  {
    provide: CHARIOW_CLIENT,
    useFactory: (options: ChariowModuleOptions): Chariow => {
      const { idempotencyStore: _ignored, ...clientOptions } = options;
      return new Chariow(clientOptions);
    },
    inject: [CHARIOW_MODULE_OPTIONS],
  },
  {
    provide: CHARIOW_PULSE_PROCESSOR,
    useFactory: (options: ChariowModuleOptions): PulseEventProcessor => {
      const store = options.idempotencyStore;
      if (store === false) return new PulseEventProcessor();
      return new PulseEventProcessor({ idempotencyStore: store ?? new InMemoryPulseIdempotencyStore() });
    },
    inject: [CHARIOW_MODULE_OPTIONS],
  },
  ChariowService,
  ChariowPulseGuard,
];

const exportedTokens = [CHARIOW_CLIENT, CHARIOW_PULSE_PROCESSOR, ChariowService, ChariowPulseGuard];

@Module({})
export class ChariowModule {
  /** Registers the module with static options. The client is created (and validated) at bootstrap. */
  static forRoot(options: ChariowModuleForRootOptions): DynamicModule {
    const { isGlobal, ...moduleOptions } = options;
    return {
      module: ChariowModule,
      global: isGlobal ?? false,
      providers: [{ provide: CHARIOW_MODULE_OPTIONS, useValue: moduleOptions }, ...sharedProviders],
      exports: exportedTokens,
    };
  }

  /** Registers the module with options resolved asynchronously (e.g. from `ConfigService`). */
  static forRootAsync(options: ChariowModuleAsyncOptions): DynamicModule {
    return {
      module: ChariowModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: [...createAsyncProviders(options), ...(options.extraProviders ?? []), ...sharedProviders],
      exports: exportedTokens,
    };
  }
}

function createAsyncProviders(options: ChariowModuleAsyncOptions): Provider[] {
  if (options.useFactory) {
    return [
      {
        provide: CHARIOW_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
    ];
  }
  const optionsClass = options.useClass ?? options.useExisting;
  if (!optionsClass) {
    throw new Error('ChariowModule.forRootAsync() requires useFactory, useClass or useExisting');
  }
  const providers: Provider[] = [
    {
      provide: CHARIOW_MODULE_OPTIONS,
      useFactory: (factory: ChariowOptionsFactory) => factory.createChariowOptions(),
      inject: [optionsClass],
    },
  ];
  if (options.useClass) providers.push({ provide: options.useClass, useClass: options.useClass });
  return providers;
}
