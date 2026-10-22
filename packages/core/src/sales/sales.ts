import { ChariowInvalidRequestError } from '../errors/index.js';
import { type HttpClient, type RequestOptions, unwrapData, unwrapList } from '../http/http-client.js';
import { paginate } from '../pagination.js';
import type { ListResult, Pagination } from '../types/common.js';
import type { ListSalesParams, SaleDetail, SaleSummary } from '../types/sales.js';
import { encodePathSegment } from '../utils.js';

/** `GET /sales` and `GET /sales/{saleId}` (scope `sales.read`). */
export class SalesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async list(params: ListSalesParams = {}, options: RequestOptions = {}): Promise<ListResult<SaleSummary>> {
    const response = await this.#http.request({ ...options, method: 'GET', path: '/sales', query: { ...params } });
    return unwrapList<SaleSummary, Pagination>(response, 'GET /sales');
  }

  /** Iterates over every sale matching the filters, following the cursors. */
  listAll(params: Omit<ListSalesParams, 'cursor'> = {}, options: RequestOptions = {}): AsyncGenerator<SaleSummary, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /** Retrieves a sale. Use it server-side to confirm a payment (`status`, `payment.status`). */
  async get(saleId: string, options: RequestOptions = {}): Promise<SaleDetail> {
    if (saleId.trim() === '') throw new ChariowInvalidRequestError(['saleId is required']);
    const response = await this.#http.request({
      ...options,
      method: 'GET',
      path: `/sales/${encodePathSegment(saleId)}`,
    });
    return unwrapData<SaleDetail>(response, 'GET /sales/{saleId}');
  }
}
