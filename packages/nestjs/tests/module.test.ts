import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Chariow, type FetchLike, PulseEventProcessor } from '@gloseije/chariow-sdk';
import { describe, expect, it } from 'vitest';
import {
  CHARIOW_CLIENT,
  CHARIOW_PULSE_PROCESSOR,
  ChariowModule,
  type ChariowModuleOptions,
  type ChariowOptionsFactory,
  ChariowService,
} from '../src/index.js';

const API_KEY = 'sk_test_fake_key_for_unit_tests_only';

function licenseResponse(): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: 'lic_1',
        status: 'active',
        license: { key: 'K-1', masked_key: 'K-*' },
        is_active: true,
        is_expired: false,
        can_activate: true,
        revoked_at: null,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function recordingFetch(): { fetch: FetchLike; urls: string[]; auth: (string | null)[] } {
  const urls: string[] = [];
  const auth: (string | null)[] = [];
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    auth.push(new Headers(init.headers).get('authorization'));
    return licenseResponse();
  };
  return { fetch, urls, auth };
}

describe('ChariowModule.forRoot', () => {
  it('provides the core client and a service that delegates HTTP calls to it', async () => {
    const { fetch, urls, auth } = recordingFetch();
    const moduleRef = await Test.createTestingModule({
      imports: [ChariowModule.forRoot({ apiKey: API_KEY, fetch })],
    }).compile();

    const client = moduleRef.get<Chariow>(CHARIOW_CLIENT);
    const service = moduleRef.get(ChariowService);
    expect(client).toBeInstanceOf(Chariow);
    expect(service.client).toBe(client);
    expect(service.licenses).toBe(client.licenses);
    expect(moduleRef.get(CHARIOW_PULSE_PROCESSOR)).toBeInstanceOf(PulseEventProcessor);

    const result = await service.validateLicense('K-1');
    expect(result.valid).toBe(true);
    expect(urls).toEqual(['https://api.chariow.com/v1/licenses/K-1']);
    expect(auth).toEqual([`Bearer ${API_KEY}`]);
  });

  it('fails at bootstrap with an invalid configuration', async () => {
    await expect(
      Test.createTestingModule({ imports: [ChariowModule.forRoot({ apiKey: '' })] }).compile(),
    ).rejects.toThrow(/API key is required/);
  });

  it('can be registered globally', async () => {
    @Injectable()
    class Consumer {
      constructor(readonly chariow: ChariowService) {}
    }
    @Module({ providers: [{ provide: Consumer, useFactory: (s: ChariowService) => new Consumer(s), inject: [ChariowService] }], exports: [Consumer] })
    class FeatureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ChariowModule.forRoot({ apiKey: API_KEY, isGlobal: true }), FeatureModule],
    }).compile();
    expect(moduleRef.get(Consumer).chariow).toBeInstanceOf(ChariowService);
  });
});

describe('ChariowModule.forRootAsync', () => {
  it('works with ConfigModule / ConfigService', async () => {
    const { fetch, urls } = recordingFetch();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ CHARIOW_API_KEY: API_KEY, CHARIOW_PULSE_SECRET: 'whsec_test', CHARIOW_TIMEOUT_MS: 5000 })],
        }),
        ChariowModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService): ChariowModuleOptions => ({
            apiKey: config.getOrThrow<string>('CHARIOW_API_KEY'),
            pulseSecret: config.getOrThrow<string>('CHARIOW_PULSE_SECRET'),
            timeoutMs: config.get<number>('CHARIOW_TIMEOUT_MS'),
            fetch,
          }),
        }),
      ],
    }).compile();

    const client = moduleRef.get<Chariow>(CHARIOW_CLIENT);
    expect(client.timeoutMs).toBe(5000);
    expect(client.webhooks).toBeDefined();
    await moduleRef.get(ChariowService).licenses.get('K-1');
    expect(urls).toHaveLength(1);
  });

  it('supports an async factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ChariowModule.forRootAsync({ useFactory: async () => ({ apiKey: API_KEY, idempotencyStore: false }) })],
    }).compile();
    expect(moduleRef.get(ChariowService).client).toBeInstanceOf(Chariow);
  });

  it('supports useClass', async () => {
    @Injectable()
    class ChariowConfig implements ChariowOptionsFactory {
      createChariowOptions(): ChariowModuleOptions {
        return { apiKey: API_KEY, timeoutMs: 1234 };
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [ChariowModule.forRootAsync({ useClass: ChariowConfig })],
    }).compile();
    expect(moduleRef.get<Chariow>(CHARIOW_CLIENT).timeoutMs).toBe(1234);
  });

  it('requires a factory, class or existing provider', () => {
    expect(() => ChariowModule.forRootAsync({})).toThrow(/useFactory, useClass or useExisting/);
  });
});
