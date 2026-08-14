import type { Money } from '../money/money.js';

/**
 * The slice of the Shopify catalog the app passes around.
 *
 * Shopify is the source of truth and the catalog is never mirrored into our
 * database, so these are transient read models — fetched live, rendered, and
 * discarded. Nothing here has an `id` of ours, only Shopify GIDs.
 */

export enum ShopifyProductStatus {
  ACTIVE = 'ACTIVE',
  DRAFT = 'DRAFT',
  ARCHIVED = 'ARCHIVED',
}

export interface ShopifyVariantSummary {
  /** GID, e.g. `gid://shopify/ProductVariant/123`. */
  id: string;
  productId: string;
  title: string;
  sku: string | null;
  price: Money;
  compareAtPrice: Money | null;
  inventoryQuantity: number | null;
}

export interface ShopifyProductSummary {
  /** GID, e.g. `gid://shopify/Product/123`. */
  id: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  status: ShopifyProductStatus;
  tags: string[];
  featuredImageUrl: string | null;
  variants: ShopifyVariantSummary[];
}

export interface ShopifyCollectionSummary {
  id: string;
  title: string;
  handle: string;
  productsCount: number | null;
}

/**
 * Shopify's cursor pagination, carried through to the admin UI unchanged so
 * the product picker can page without us holding server-side state.
 */
export interface ShopifyPage<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}
