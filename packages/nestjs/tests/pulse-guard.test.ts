import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Controller, HttpCode, Inject, type INestApplication, Post, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import type { PulseEvent } from '@gloseije/chariow-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChariowModule, ChariowPulse, ChariowPulseGuard, ChariowService } from '../src/index.js';

const SECRET = 'whsec_fake_secret_for_unit_tests_only';
const handled: string[] = [];

@Controller('webhooks')
class PulseController {
  constructor(@Inject(ChariowService) private readonly chariow: ChariowService) {
    this.chariow.onPulse('successful.sale', (event) => {
      handled.push(event.payload.sale.id);
    });
  }

  @Post('chariow')
  @HttpCode(200)
  @UseGuards(ChariowPulseGuard)
  async receive(@ChariowPulse() event: PulseEvent): Promise<{ type: string; known: boolean; status: string }> {
    const result = await this.chariow.dispatchPulse(event);
    return { type: event.type, known: event.known, status: result.status };
  }
}

@Module({
  imports: [ChariowModule.forRoot({ apiKey: 'sk_test_fake', pulseSecret: SECRET })],
  controllers: [PulseController],
})
class AppModule {}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('ChariowPulseGuard (Express, rawBody: true)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/webhooks/chariow`.replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  function post(body: string, headers: Record<string, string>): Promise<Response> {
    return fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
  }

  const body = '{"event":"successful.sale","sale":{"id":"sal_1","status":"completed"},"product":{"url":"https:\\/\\/s.example"}}';

  it('accepts a correctly signed delivery and deduplicates retries', async () => {
    const headers = { 'x-chariow-signature': sign(body), 'x-pulse-delivery-id': 'dlv_guard_1', 'x-pulse-event': 'successful.sale' };
    const first = await post(body, headers);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ type: 'successful.sale', known: true, status: 'processed' });

    const retry = await post(body, headers);
    expect(await retry.json()).toEqual({ type: 'successful.sale', known: true, status: 'duplicate' });
    expect(handled).toEqual(['sal_1']);
  });

  it('accepts unknown events without failing', async () => {
    const unknown = '{"event":"something.new"}';
    const response = await post(unknown, { 'x-chariow-signature': sign(unknown), 'x-pulse-delivery-id': 'dlv_guard_2' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 'something.new', known: false, status: 'unhandled' });
  });

  it('rejects an invalid signature with 401', async () => {
    const response = await post(body, { 'x-chariow-signature': sign(body, 'whsec_wrong') });
    expect(response.status).toBe(401);
  });

  it('rejects a missing signature with 401', async () => {
    expect((await post(body, {})).status).toBe(401);
  });

  it('rejects a signed but invalid payload with 400', async () => {
    const invalid = '{"no_event":true}';
    expect((await post(invalid, { 'x-chariow-signature': sign(invalid) })).status).toBe(400);
  });
});
