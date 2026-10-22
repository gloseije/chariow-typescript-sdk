import { ChariowInvalidRequestError } from '../errors/index.js';
import { type HttpClient, type RequestOptions, unwrapData, unwrapList } from '../http/http-client.js';
import { paginate } from '../pagination.js';
import type { ListResult, Pagination } from '../types/common.js';
import type { ListPulsesParams, Pulse } from '../types/pulses.js';
import { encodePathSegment } from '../utils.js';

/**
 * Read-only access to Pulse configurations (`GET /pulses`, `GET /pulses/{pulseId}`,
 * scope `webhooks.read`). Chariow does not document endpoints to create, update or delete Pulses:
 * they are managed from the dashboard.
 */
export class PulsesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async list(params: ListPulsesParams = {}, options: RequestOptions = {}): Promise<ListResult<Pulse>> {
    const response = await this.#http.request({ ...options, method: 'GET', path: '/pulses', query: { ...params } });
    return unwrapList<Pulse, Pagination>(response, 'GET /pulses');
  }

  listAll(params: Omit<ListPulsesParams, 'cursor'> = {}, options: RequestOptions = {}): AsyncGenerator<Pulse, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  async get(pulseId: string, options: RequestOptions = {}): Promise<Pulse> {
    if (pulseId.trim() === '') throw new ChariowInvalidRequestError(['pulseId is required']);
    const response = await this.#http.request({
      ...options,
      method: 'GET',
      path: `/pulses/${encodePathSegment(pulseId)}`,
    });
    return unwrapData<Pulse>(response, 'GET /pulses/{pulseId}');
  }
}
