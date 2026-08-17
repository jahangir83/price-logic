import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShopifyPage } from '@pricelogic/shared';
import { ApiError } from '../api/client';

interface PagedSearchState<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasNextPage: boolean;
}

/**
 * Debounced, cursor-paginated search against a catalog endpoint.
 *
 * Two things it exists to get right, because every picker would otherwise
 * reimplement them:
 *
 * - **Debounce**, so typing "t-shirt" is one request rather than seven. The
 *   catalog is a live Shopify call behind a cost-based rate limit; a request
 *   per keystroke spends the merchant's budget on results nobody read.
 * - **Discarding stale responses.** A slow request for "sh" must not overwrite
 *   the results for "shirt" when it finally lands.
 */
export function usePagedSearch<T>(
  load: (params: { query: string; after: string | null }) => Promise<ShopifyPage<T>>,
  options: { debounceMs?: number } = {},
) {
  const debounceMs = options.debounceMs ?? 300;

  const [query, setQuery] = useState('');
  const [state, setState] = useState<PagedSearchState<T>>({
    items: [],
    loading: true,
    loadingMore: false,
    error: null,
    hasNextPage: false,
  });

  const cursor = useRef<string | null>(null);
  /** Incremented per search; a response from an older generation is dropped. */
  const generation = useRef(0);

  const run = useCallback(
    async (searchTerm: string, after: string | null, append: boolean) => {
      const mine = append ? generation.current : (generation.current += 1);

      setState((previous) => ({
        ...previous,
        loading: !append,
        loadingMore: append,
        error: null,
      }));

      try {
        const page = await load({ query: searchTerm, after });
        if (mine !== generation.current) return;

        cursor.current = page.endCursor;
        setState((previous) => ({
          items: append ? [...previous.items, ...page.items] : page.items,
          loading: false,
          loadingMore: false,
          error: null,
          hasNextPage: page.hasNextPage,
        }));
      } catch (error) {
        if (mine !== generation.current) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          loadingMore: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'Could not load from Shopify.',
        }));
      }
    },
    [load],
  );

  useEffect(() => {
    const timer = setTimeout(() => void run(query, null, false), debounceMs);
    return () => clearTimeout(timer);
  }, [query, run, debounceMs]);

  const loadMore = useCallback(() => {
    if (!state.hasNextPage || state.loadingMore) return;
    void run(query, cursor.current, true);
  }, [query, run, state.hasNextPage, state.loadingMore]);

  const retry = useCallback(() => void run(query, null, false), [query, run]);

  return useMemo(
    () => ({ ...state, query, setQuery, loadMore, retry }),
    [state, query, loadMore, retry],
  );
}
