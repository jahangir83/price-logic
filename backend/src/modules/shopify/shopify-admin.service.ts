import { Injectable, Logger } from '@nestjs/common';
import {
  Money,
  ShopifyCollectionSummary,
  ShopifyPage,
  ShopifyProductStatus,
  ShopifyProductSummary,
  ShopifyVariantSummary,
  parseMoney,
} from '@pricelogic/shared';
import { Shop } from '../shops/entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { TTL, ShopifyResponseCache } from './response-cache';
import { ShopifyGraphQlClient } from './shopify-graphql.client';

/** A variant resolved for pricing — the shape Phases 4-6 consume. */
export interface VariantPriceRecord {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  price: Money;
  compareAtPrice: Money | null;
}

/** One SKU's resolution. `variants.length > 1` means the sheet is ambiguous. */
export interface SkuMatch {
  sku: string;
  variants: VariantPriceRecord[];
}

/**
 * A variant plus the product facets targeting needs.
 *
 * Carries the parent's tags, vendor, type and status so an exclusion can be
 * applied without a second lookup per product — a campaign excluding one
 * vendor should not cost one query per product to find out.
 */
export interface CatalogVariant extends VariantPriceRecord {
  productStatus: ShopifyProductStatus;
  productTags: string[];
  productVendor: string | null;
  productType: string | null;
}

interface GqlPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GqlProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  featuredImage: { url: string } | null;
  variantsCount: { count: number } | null;
}

interface GqlProductWithVariants extends GqlProductNode {
  variants: {
    edges: {
      node: {
        id: string;
        title: string;
        sku: string | null;
        price: string;
        compareAtPrice: string | null;
      };
    }[];
  };
}

interface GqlVariantNode {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  product: { id: string; title: string };
}

/**
 * The only thing in the app that knows Shopify exists.
 *
 * Per the constitution, no controller and no React component calls the Admin
 * API directly. Everything routes through here, which is what makes rate
 * limiting, version pinning and error translation enforceable rather than
 * conventions each caller has to remember.
 *
 * Nothing is stored. Shopify is the source of truth for the catalog, so these
 * are read models — fetched, rendered, discarded — and the only Shopify
 * identifiers that survive are the plain id strings on our own rows.
 */
@Injectable()
export class ShopifyAdminService {
  private readonly logger = new Logger(ShopifyAdminService.name);

  constructor(
    private readonly client: ShopifyGraphQlClient,
    private readonly shops: ShopsService,
    private readonly cache: ShopifyResponseCache,
  ) {}

  private credentials(shop: Shop) {
    return {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      // Decrypted per call and never held — see ShopsService.
      accessToken: this.shops.getDecryptedAccessToken(shop),
    };
  }

  // -------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------

  /**
   * Paginated product search, for the "Include by Products" picker.
   *
   * Fetches `variantsCount` rather than the variants themselves — a picker
   * shows "12 variants", and pulling twelve variant nodes per row multiplies
   * the query cost for data nobody reads.
   */
  async searchProducts(
    shop: Shop,
    options: { query?: string; first?: number; after?: string | null } = {},
  ): Promise<ShopifyPage<ShopifyProductSummary>> {
    const first = clampPageSize(options.first);
    const search = options.query?.trim() ?? '';

    return this.cache.wrap(
      shop.id,
      ['products', search, first, options.after ?? null],
      TTL.SEARCH_MS,
      async () => {
        const data = await this.client.request<{
          products: {
            edges: { node: GqlProductNode }[];
            pageInfo: GqlPageInfo;
          };
        }>({
          ...this.credentials(shop),
          estimatedCost: first * 2,
          query: PRODUCT_SEARCH_QUERY,
          variables: {
            first,
            after: options.after ?? null,
            query: search ? `title:*${escapeSearchTerm(search)}*` : null,
          },
        });

        return {
          items: data.products.edges.map((edge) => toProductSummary(edge.node)),
          hasNextPage: data.products.pageInfo.hasNextPage,
          endCursor: data.products.pageInfo.endCursor,
        };
      },
    );
  }

  // -------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------

  /**
   * Custom and smart collections together — Shopify's `collections` field
   * already spans both, and a merchant picking a collection does not care
   * which kind it is.
   */
  async searchCollections(
    shop: Shop,
    options: { query?: string; first?: number; after?: string | null } = {},
  ): Promise<ShopifyPage<ShopifyCollectionSummary>> {
    const first = clampPageSize(options.first);
    const search = options.query?.trim() ?? '';

    return this.cache.wrap(
      shop.id,
      ['collections', search, first, options.after ?? null],
      TTL.SEARCH_MS,
      async () => {
        const data = await this.client.request<{
          collections: {
            edges: {
              node: {
                id: string;
                title: string;
                handle: string;
                productsCount: { count: number } | null;
              };
            }[];
            pageInfo: GqlPageInfo;
          };
        }>({
          ...this.credentials(shop),
          estimatedCost: first,
          query: COLLECTION_SEARCH_QUERY,
          variables: {
            first,
            after: options.after ?? null,
            query: search ? `title:*${escapeSearchTerm(search)}*` : null,
          },
        });

        return {
          items: data.collections.edges.map((edge) => ({
            id: edge.node.id,
            title: edge.node.title,
            handle: edge.node.handle,
            productsCount: edge.node.productsCount?.count ?? null,
          })),
          hasNextPage: data.collections.pageInfo.hasNextPage,
          endCursor: data.collections.pageInfo.endCursor,
        };
      },
    );
  }

  // -------------------------------------------------------------------
  // Facets
  // -------------------------------------------------------------------

  /**
   * Distinct tags, vendors and product types.
   *
   * Cached far longer than search: these are shop-wide lists a merchant edits
   * rarely, and they back a picker that filters client-side once loaded.
   */
  async listTags(shop: Shop, first = 250): Promise<string[]> {
    return this.cache.wrap(
      shop.id,
      ['tags', first],
      TTL.FACETS_MS,
      async () => {
        const data = await this.client.request<{
          shop: { productTags: { edges: { node: string }[] } };
        }>({
          ...this.credentials(shop),
          estimatedCost: 10,
          query: PRODUCT_TAGS_QUERY,
          variables: { first },
        });
        return data.shop.productTags.edges.map((edge) => edge.node);
      },
    );
  }

  async listVendors(shop: Shop, first = 250): Promise<string[]> {
    return this.cache.wrap(
      shop.id,
      ['vendors', first],
      TTL.FACETS_MS,
      async () => {
        const data = await this.client.request<{
          shop: { productVendors: { edges: { node: string }[] } };
        }>({
          ...this.credentials(shop),
          estimatedCost: 10,
          query: PRODUCT_VENDORS_QUERY,
          variables: { first },
        });
        return data.shop.productVendors.edges.map((edge) => edge.node);
      },
    );
  }

  async listProductTypes(shop: Shop, first = 250): Promise<string[]> {
    return this.cache.wrap(
      shop.id,
      ['productTypes', first],
      TTL.FACETS_MS,
      async () => {
        const data = await this.client.request<{
          shop: { productTypes: { edges: { node: string }[] } };
        }>({
          ...this.credentials(shop),
          estimatedCost: 10,
          query: PRODUCT_TYPES_QUERY,
          variables: { first },
        });
        return data.shop.productTypes.edges.map((edge) => edge.node);
      },
    );
  }

  // -------------------------------------------------------------------
  // Variant pricing
  // -------------------------------------------------------------------

  /**
   * Current prices for a list of variant ids.
   *
   * Batched through `nodes`, never one query per variant — a 5,000-variant
   * campaign would otherwise be 5,000 round trips and would exhaust the cost
   * bucket many times over.
   *
   * `useCache` defaults to false on purpose. This is the method Phase 6 calls
   * immediately before mutating, and a price from thirty seconds ago produces
   * a wrong discount that looks right. Callers rendering a preview may opt in.
   */
  async fetchVariantPrices(
    shop: Shop,
    variantIds: readonly string[],
    options: { useCache?: boolean } = {},
  ): Promise<VariantPriceRecord[]> {
    if (variantIds.length === 0) return [];

    const load = async (): Promise<VariantPriceRecord[]> => {
      const records: VariantPriceRecord[] = [];
      for (const batch of chunk(variantIds, VARIANT_BATCH_SIZE)) {
        const data = await this.client.request<{
          nodes: (GqlVariantNode | null)[];
        }>({
          ...this.credentials(shop),
          estimatedCost: batch.length,
          query: VARIANT_NODES_QUERY,
          variables: { ids: batch },
        });

        for (const node of data.nodes) {
          // A null node is a variant that was deleted between our reading an
          // id and asking for it. Skipping is correct — there is nothing to
          // price — and the caller sees a shorter list than it asked for.
          if (node) records.push(toVariantPriceRecord(node));
        }
      }
      return records;
    };

    if (!options.useCache) return load();

    return this.cache.wrap(
      shop.id,
      ['variantPrices', [...variantIds].sort()],
      TTL.PRICES_MS,
      load,
    );
  }

  /**
   * Resolve SKUs from an uploaded sheet to variants.
   *
   * Returns **every** match for a SKU rather than picking one. Two products
   * sharing a SKU is a merchant data problem, and silently repricing whichever
   * Shopify returned first is exactly the kind of invisible wrong answer the
   * approval screen exists to prevent — the caller flags the row UNMATCHED
   * instead.
   */
  async findVariantsBySku(
    shop: Shop,
    skus: readonly string[],
  ): Promise<SkuMatch[]> {
    const unique = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
    if (unique.length === 0) return [];

    const bySku = new Map<string, VariantPriceRecord[]>(
      unique.map((sku) => [sku, []]),
    );

    for (const batch of chunk(unique, SKU_BATCH_SIZE)) {
      // One query per batch using Shopify's OR search syntax.
      const query = batch
        .map((sku) => `sku:'${escapeSearchTerm(sku)}'`)
        .join(' OR ');

      let after: string | null = null;
      let hasNextPage = true;
      while (hasNextPage) {
        const data: {
          productVariants: {
            edges: { node: GqlVariantNode }[];
            pageInfo: GqlPageInfo;
          };
        } = await this.client.request({
          ...this.credentials(shop),
          estimatedCost: 100,
          query: VARIANT_BY_SKU_QUERY,
          variables: { first: 250, after, query },
        });

        for (const edge of data.productVariants.edges) {
          const record = toVariantPriceRecord(edge.node);
          // Shopify's search is fuzzy at the edges; keep only exact matches so
          // a sheet row cannot be applied to a similarly-named SKU.
          const bucket = record.sku ? bySku.get(record.sku) : undefined;
          bucket?.push(record);
        }

        hasNextPage = data.productVariants.pageInfo.hasNextPage;
        after = data.productVariants.pageInfo.endCursor;
      }
    }

    return unique.map((sku) => ({ sku, variants: bySku.get(sku) ?? [] }));
  }

  // -------------------------------------------------------------------
  // Enumeration, for target resolution
  // -------------------------------------------------------------------

  /**
   * Every variant of every product matching a Shopify search query.
   *
   * Paginated all the way through, because an ALL_PRODUCTS campaign on a real
   * store is tens of thousands of variants and a single page would silently
   * price a fraction of the catalog — the worst kind of wrong, because it
   * looks like it worked.
   *
   * `limit` caps the walk. Hitting it is reported rather than hidden: a
   * preview that says "showing the first 10,000" is honest, one that just
   * stops is not.
   */
  async listVariantsMatching(
    shop: Shop,
    query: string | null,
    options: { limit?: number } = {},
  ): Promise<{ variants: CatalogVariant[]; truncated: boolean }> {
    const limit = options.limit ?? DEFAULT_RESOLUTION_LIMIT;
    const variants: CatalogVariant[] = [];
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage && variants.length < limit) {
      const data: {
        products: {
          edges: { node: GqlProductWithVariants }[];
          pageInfo: GqlPageInfo;
        };
      } = await this.client.request({
        ...this.credentials(shop),
        // Products are cheap; their variant connections are not.
        estimatedCost: PRODUCT_PAGE_SIZE * 3,
        query: PRODUCTS_WITH_VARIANTS_QUERY,
        variables: { first: PRODUCT_PAGE_SIZE, after, query },
      });

      for (const edge of data.products.edges) {
        variants.push(...toCatalogVariants(edge.node));
      }
      hasNextPage = data.products.pageInfo.hasNextPage;
      after = data.products.pageInfo.endCursor;
    }

    return {
      variants: variants.slice(0, limit),
      truncated:
        variants.length > limit || (hasNextPage && variants.length >= limit),
    };
  }

  /** Every variant of a collection's products. */
  async listCollectionVariants(
    shop: Shop,
    collectionId: string,
    options: { limit?: number } = {},
  ): Promise<{ variants: CatalogVariant[]; truncated: boolean }> {
    const limit = options.limit ?? DEFAULT_RESOLUTION_LIMIT;
    const variants: CatalogVariant[] = [];
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage && variants.length < limit) {
      const data: {
        collection: {
          products: {
            edges: { node: GqlProductWithVariants }[];
            pageInfo: GqlPageInfo;
          };
        } | null;
      } = await this.client.request({
        ...this.credentials(shop),
        estimatedCost: PRODUCT_PAGE_SIZE * 3,
        query: COLLECTION_VARIANTS_QUERY,
        variables: { id: collectionId, first: PRODUCT_PAGE_SIZE, after },
      });

      // A collection deleted since the merchant picked it resolves to nothing
      // rather than failing the whole campaign.
      if (!data.collection) break;

      for (const edge of data.collection.products.edges) {
        variants.push(...toCatalogVariants(edge.node));
      }
      hasNextPage = data.collection.products.pageInfo.hasNextPage;
      after = data.collection.products.pageInfo.endCursor;
    }

    return {
      variants: variants.slice(0, limit),
      truncated: hasNextPage && variants.length >= limit,
    };
  }

  /** Every variant of the named products. */
  async listProductVariants(
    shop: Shop,
    productIds: readonly string[],
  ): Promise<CatalogVariant[]> {
    if (productIds.length === 0) return [];

    const variants: CatalogVariant[] = [];
    for (const batch of chunk(productIds, PRODUCT_NODE_BATCH)) {
      const data = await this.client.request<{
        nodes: (GqlProductWithVariants | null)[];
      }>({
        ...this.credentials(shop),
        estimatedCost: batch.length * 3,
        query: PRODUCT_NODES_QUERY,
        variables: { ids: batch },
      });
      for (const node of data.nodes) {
        if (node) variants.push(...toCatalogVariants(node));
      }
    }
    return variants;
  }

  /** Drop cached catalog data for a shop — call after changing prices. */
  invalidate(shopId: string): void {
    this.cache.invalidateShop(shopId);
  }
}

// -------------------------------------------------------------------
// Mapping
// -------------------------------------------------------------------

function toProductSummary(node: GqlProductNode): ShopifyProductSummary {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    vendor: node.vendor,
    productType: node.productType,
    status: toProductStatus(node.status),
    tags: node.tags,
    featuredImageUrl: node.featuredImage?.url ?? null,
    // The picker shows a count; the variants themselves are fetched only when
    // a campaign actually needs to price them.
    variants: [],
  };
}

function toProductStatus(status: string): ShopifyProductStatus {
  switch (status) {
    case 'ACTIVE':
      return ShopifyProductStatus.ACTIVE;
    case 'ARCHIVED':
      return ShopifyProductStatus.ARCHIVED;
    default:
      return ShopifyProductStatus.DRAFT;
  }
}

function toVariantPriceRecord(node: GqlVariantNode): VariantPriceRecord {
  return {
    variantId: node.id,
    productId: node.product.id,
    productTitle: node.product.title,
    variantTitle: node.title,
    sku: node.sku,
    // Through parseMoney, so a price that is not exact decimal money fails
    // here rather than silently becoming a float three layers down.
    price: parseMoney(node.price, 'variant.price'),
    compareAtPrice:
      node.compareAtPrice === null
        ? null
        : parseMoney(node.compareAtPrice, 'variant.compareAtPrice'),
  };
}

function toCatalogVariants(node: GqlProductWithVariants): CatalogVariant[] {
  const status = toProductStatus(node.status);
  return node.variants.edges.map((edge) => ({
    variantId: edge.node.id,
    productId: node.id,
    productTitle: node.title,
    variantTitle: edge.node.title,
    sku: edge.node.sku,
    price: parseMoney(edge.node.price, 'variant.price'),
    compareAtPrice:
      edge.node.compareAtPrice === null
        ? null
        : parseMoney(edge.node.compareAtPrice, 'variant.compareAtPrice'),
    productStatus: status,
    productTags: node.tags,
    productVendor: node.vendor,
    productType: node.productType,
  }));
}

export function toVariantSummary(
  record: VariantPriceRecord,
  inventoryQuantity: number | null = null,
): ShopifyVariantSummary {
  return {
    id: record.variantId,
    productId: record.productId,
    title: record.variantTitle,
    sku: record.sku,
    price: record.price,
    compareAtPrice: record.compareAtPrice,
    inventoryQuantity,
  };
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/** Shopify's hard ceiling is 250 per page. */
function clampPageSize(first: number | undefined): number {
  return Math.min(Math.max(first ?? 50, 1), 250);
}

const VARIANT_BATCH_SIZE = 250;
const SKU_BATCH_SIZE = 50;
/** Products per page while enumerating; each carries up to 100 variants. */
const PRODUCT_PAGE_SIZE = 50;
const PRODUCT_NODE_BATCH = 50;
/**
 * Safety ceiling on one resolution. A store with more variants than this in
 * scope needs the bulk operations API, not a paged walk — and the preview says
 * so rather than pretending it saw everything.
 */
export const DEFAULT_RESOLUTION_LIMIT = 50_000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Quotes and backslashes would otherwise break out of a search term. */
function escapeSearchTerm(term: string): string {
  return term.replace(/(["'\\])/g, '\\$1');
}

// -------------------------------------------------------------------
// Documents
// -------------------------------------------------------------------

const PRODUCT_SEARCH_QUERY = `
  query ProductSearch($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          tags
          featuredImage { url }
          variantsCount { count }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_SEARCH_QUERY = `
  query CollectionSearch($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query, sortKey: TITLE) {
      edges {
        node {
          id
          title
          handle
          productsCount { count }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_TAGS_QUERY = `
  query ProductTags($first: Int!) {
    shop { productTags(first: $first) { edges { node } } }
  }
`;

const PRODUCT_VENDORS_QUERY = `
  query ProductVendors($first: Int!) {
    shop { productVendors(first: $first) { edges { node } } }
  }
`;

const PRODUCT_TYPES_QUERY = `
  query ProductTypes($first: Int!) {
    shop { productTypes(first: $first) { edges { node } } }
  }
`;

const VARIANT_FIELDS = `
  id
  title
  sku
  price
  compareAtPrice
  inventoryQuantity
  product { id title }
`;

const VARIANT_NODES_QUERY = `
  query VariantPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant { ${VARIANT_FIELDS} }
    }
  }
`;

const PRODUCT_WITH_VARIANTS_FIELDS = `
  id
  title
  handle
  status
  vendor
  productType
  tags
  featuredImage { url }
  variantsCount { count }
  variants(first: 100) {
    edges { node { id title sku price compareAtPrice } }
  }
`;

const PRODUCTS_WITH_VARIANTS_QUERY = `
  query ProductsWithVariants($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges { node { ${PRODUCT_WITH_VARIANTS_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_VARIANTS_QUERY = `
  query CollectionVariants($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        edges { node { ${PRODUCT_WITH_VARIANTS_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const PRODUCT_NODES_QUERY = `
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { ${PRODUCT_WITH_VARIANTS_FIELDS} }
    }
  }
`;

const VARIANT_BY_SKU_QUERY = `
  query VariantsBySku($first: Int!, $after: String, $query: String!) {
    productVariants(first: $first, after: $after, query: $query) {
      edges { node { ${VARIANT_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
