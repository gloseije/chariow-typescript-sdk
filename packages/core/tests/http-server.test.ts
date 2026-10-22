import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Chariow, ChariowNotFoundError } from '../src/index.js';
import { licenseFixture, TEST_API_KEY } from './helpers.js';

interface Captured {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('against a local HTTP test server (global fetch)', () => {
  let server: Server;
  let baseUrl: string;
  const captured: Captured[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        captured.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/licenses/MISSING') {
          res.statusCode = 404;
          res.end(JSON.stringify({ message: 'License not found', errors: [] }));
          return;
        }
        res.end(JSON.stringify({ message: 'License activated successfully', data: licenseFixture() }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('performs real HTTP requests with auth and JSON body', async () => {
    const chariow = new Chariow({ apiKey: TEST_API_KEY, baseUrl });
    const result = await chariow.licenses.activate('ABCD-1234', { device_identifier: 'device-1' });
    const request = captured.at(-1)!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/licenses/ABCD-1234/activate');
    expect(request.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(request.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request.body)).toEqual({ device_identifier: 'device-1' });
    expect(result.license.id).toBe('lic_test123');
  });

  it('maps server errors', async () => {
    const chariow = new Chariow({ apiKey: TEST_API_KEY, baseUrl });
    await expect(chariow.licenses.get('MISSING')).rejects.toBeInstanceOf(ChariowNotFoundError);
  });
});
