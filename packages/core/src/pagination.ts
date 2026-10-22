import type { Pagination } from './types/common.js';

export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

/**
 * Iterates over every item of a cursor-paginated endpoint by following
 * `pagination.next_cursor` until `has_more_pages` is false.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  startCursor?: string,
): AsyncGenerator<T, void, undefined> {
  let cursor = startCursor;
  const seen = new Set<string>();
  for (;;) {
    const page = await fetchPage(cursor);
    yield* page.data;
    const next = page.pagination.next_cursor;
    if (!page.pagination.has_more_pages || !next || seen.has(next)) return;
    seen.add(next);
    cursor = next;
  }
}
