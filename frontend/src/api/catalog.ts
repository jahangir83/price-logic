import type {
  ShopifyCollectionSummary,
  ShopifyPage,
  ShopifyProductSummary,
} from '@pricelogic/shared';
import { apiFetch } from './client';

/**
 * The catalog endpoints backing the pickers.
 *
 * The browser never calls Shopify — it calls our API, which owns the token,
 * the rate limit and the error translation. The response types come from
 * `@pricelogic/shared`, so a field added to the adapter and not here is a
 * compile error rather than an undefined at runtime.
 */

export interface CatalogQuery {
  query?: string;
  after?: string | null;
  first?: number;
}

function toSearchParams(params: CatalogQuery): string {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.after) search.set('after', params.after);
  if (params.first) search.set('first', String(params.first));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function fetchProducts(
  params: CatalogQuery = {},
): Promise<ShopifyPage<ShopifyProductSummary>> {
  return apiFetch(`/catalog/products${toSearchParams(params)}`);
}

export function fetchCollections(
  params: CatalogQuery = {},
): Promise<ShopifyPage<ShopifyCollectionSummary>> {
  return apiFetch(`/catalog/collections${toSearchParams(params)}`);
}

export interface CatalogFacets {
  tags: string[];
  vendors: string[];
  productTypes: string[];
}

export function fetchFacets(): Promise<CatalogFacets> {
  return apiFetch('/catalog/facets');
}
