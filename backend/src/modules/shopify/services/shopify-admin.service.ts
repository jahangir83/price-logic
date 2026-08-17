import { Injectable, Logger } from '@nestjs/common';
import {
  Money,
  ShopifyCollectionSummary,
  ShopifyPage,
  ShopifyProductStatus,
  ShopifyProductSummary,
  ShopifyVariantSummary,
  parseMoney,
  toShopifyPrice,
} from '@pricelogic/shared';
import { Shop } from '../../shops/entities/shop.entity';
import { ShopsService } from '../../shops/services/shops.service';
import { TTL, ShopifyResponseCache } from '../response-cache';
import { ShopifyGraphQlClient } from '../shopify-graphql.client';
import { ShopifyApiError } from '../shopify.errors';

/** A variant resolved for pricing — the shape Phases 4-6 consume. */
export interface VariantPriceRecord {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  /** UPC / EAN / GTIN, when the merchant has set one. */
  barcode: string | null;
  price: Money;
  compareAtPrice: Money | null;
  /**
   * Null when Shopify does not track inventory for this variant — which is not
   * the same as zero, and must never be read as "out of stock".
   */
  inventoryQuantity: number | null;
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
/** One variant's new prices, ready to send. */
export interface VariantPriceUpdate {
  variantId: string;
  price: Money;
  compareAtPrice: Money | null;
}

/** A subscription as Shopify sees it. Their status strings, not ours. */
export interface ShopifySubscriptionState {
  subscriptionGid: string;
  /** ACTIVE | PENDING | DECLINED | EXPIRED | FROZEN | CANCELLED */
  status: string;
  name: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  createdAt: string;
}

/** What Shopify did with one variant in a bulk update. */
export interface VariantUpdateOutcome {
  variantId: string;
  applied: boolean;
  error: string | null;
}

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
        inventoryQuantity: number | null;
      };
    }[];
  };
}

interface GqlVariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
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
    return this.findVariantsByField(shop, 'sku', skus);
  }

  /**
   * The same lookup, by barcode.
   *
   * The last rung of the matching ladder, and often the one that rescues a row:
   * a barcode is assigned by the manufacturer rather than by the merchant or
   * the supplier, so it survives either of them renaming their codes.
   */
  async findVariantsByBarcode(
    shop: Shop,
    barcodes: readonly string[],
  ): Promise<SkuMatch[]> {
    return this.findVariantsByField(shop, 'barcode', barcodes);
  }

  /**
   * Look variants up by one exact-match identifier field.
   *
   * Shared by every rung of the ladder so batching, pagination and — most
   * importantly — the exact-match filter below cannot differ between them. A
   * rung that quietly accepted a fuzzy match would be worse than one that found
   * nothing.
   */
  private async findVariantsByField(
    shop: Shop,
    field: 'sku' | 'barcode',
    values: readonly string[],
  ): Promise<SkuMatch[]> {
    const unique = [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    if (unique.length === 0) return [];

    const byValue = new Map<string, VariantPriceRecord[]>(
      unique.map((value) => [value, []]),
    );

    for (const batch of chunk(unique, SKU_BATCH_SIZE)) {
      // One query per batch using Shopify's OR search syntax.
      const query = batch
        .map((value) => `${field}:'${escapeSearchTerm(value)}'`)
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
          // a sheet row cannot be applied to a similarly-named identifier.
          const actual = field === 'sku' ? record.sku : record.barcode;
          const bucket = actual ? byValue.get(actual) : undefined;
          bucket?.push(record);
        }

        hasNextPage = data.productVariants.pageInfo.hasNextPage;
        after = data.productVariants.pageInfo.endCursor;
      }
    }

    return unique.map((value) => ({
      sku: value,
      variants: byValue.get(value) ?? [],
    }));
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

  // -------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------

  /**
   * Write new prices for one product's variants.
   *
   * `productVariantsBulkUpdate` takes many variants of a *single* product per
   * call, which is why activation groups by product — one call for a
   * twelve-variant shirt instead of twelve.
   *
   * Per-variant failures come back as `userErrors` alongside the successes.
   * They are returned rather than thrown: one bad variant must not abandon the
   * other eleven, and the caller records each outcome on its own row.
   */
  async updateVariantPrices(
    shop: Shop,
    productId: string,
    variants: readonly VariantPriceUpdate[],
  ): Promise<VariantUpdateOutcome[]> {
    if (variants.length === 0) return [];

    const data = await this.client.request<{
      productVariantsBulkUpdate: {
        productVariants: { id: string }[] | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10 + variants.length,
      query: VARIANTS_BULK_UPDATE_MUTATION,
      variables: {
        productId,
        variants: variants.map((variant) => ({
          id: variant.variantId,
          // Shopify stores two decimal places; sending four is rejected.
          price: toShopifyPrice(variant.price),
          ...(variant.compareAtPrice === null
            ? { compareAtPrice: null }
            : { compareAtPrice: toShopifyPrice(variant.compareAtPrice) }),
        })),
      },
    });

    const result = data.productVariantsBulkUpdate;
    const updated = new Set(
      (result.productVariants ?? []).map((variant) => variant.id),
    );

    /*
     * Shopify reports errors positionally — `field: ["variants", "3", "price"]`
     * — so the index is how a message is attributed to the right variant. A
     * message with no usable index applies to the whole call.
     */
    const errorsByIndex = new Map<number, string>();
    let batchError: string | null = null;
    for (const error of result.userErrors) {
      const index = Number(error.field?.[1]);
      if (Number.isInteger(index)) {
        errorsByIndex.set(index, error.message);
      } else {
        batchError = batchError
          ? `${batchError}; ${error.message}`
          : error.message;
      }
    }

    return variants.map((variant, index) => {
      const error = errorsByIndex.get(index) ?? batchError;
      if (error) {
        return { variantId: variant.variantId, applied: false, error };
      }
      // No error and not in the returned set means Shopify silently ignored
      // it; treating that as success would mark a row APPLIED that never was.
      if (!updated.has(variant.variantId)) {
        return {
          variantId: variant.variantId,
          applied: false,
          error: 'Shopify did not confirm this variant was updated.',
        };
      }
      return { variantId: variant.variantId, applied: true, error: null };
    });
  }

  /**
   * Replace a product's tag set.
   *
   * The whole list is written rather than adding and removing individually,
   * because the caller has already computed the exact resulting set and
   * `product_tag_changes` records that same list — so what is stored and what
   * is sent cannot drift.
   */
  async updateProductTags(
    shop: Shop,
    productId: string,
    tags: readonly string[],
  ): Promise<{ applied: boolean; error: string | null }> {
    const data = await this.client.request<{
      productUpdate: {
        product: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10,
      query: PRODUCT_TAGS_UPDATE_MUTATION,
      variables: { input: { id: productId, tags: [...tags] } },
    });

    const errors = data.productUpdate.userErrors;
    if (errors.length > 0) {
      return {
        applied: false,
        error: errors.map((error) => error.message).join('; '),
      };
    }
    return { applied: data.productUpdate.product !== null, error: null };
  }

  // -------------------------------------------------------------------
  // Billing
  // -------------------------------------------------------------------

  /**
   * Create a recurring charge and get the URL the merchant must confirm at.
   *
   * Nothing is charged until they accept — Shopify hosts that screen, and we
   * only learn the outcome from the return redirect and the
   * `APP_SUBSCRIPTIONS_UPDATE` webhook. The subscription is therefore PENDING
   * from our side until Shopify says otherwise.
   *
   * `test: true` in development, so a dev store can accept a charge without
   * anyone being billed.
   */
  async createSubscription(
    shop: Shop,
    input: {
      planName: string;
      priceCents: number;
      interval: 'EVERY_30_DAYS' | 'ANNUAL';
      trialDays: number;
      returnUrl: string;
      currencyCode?: string;
      test?: boolean;
    },
  ): Promise<{ subscriptionGid: string; confirmationUrl: string }> {
    const data = await this.client.request<{
      appSubscriptionCreate: {
        appSubscription: { id: string } | null;
        confirmationUrl: string | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10,
      query: APP_SUBSCRIPTION_CREATE_MUTATION,
      variables: {
        name: input.planName,
        returnUrl: input.returnUrl,
        trialDays: input.trialDays,
        test: input.test ?? false,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                // Shopify wants a decimal string; our prices are integer cents.
                price: {
                  amount: (input.priceCents / 100).toFixed(2),
                  currencyCode: input.currencyCode ?? 'USD',
                },
                interval: input.interval,
              },
            },
          },
        ],
      },
    });

    const result = data.appSubscriptionCreate;
    if (result.userErrors.length > 0) {
      throw ShopifyApiError.userError(
        result.userErrors.map((error) => error.message).join('; '),
      );
    }
    if (!result.appSubscription || !result.confirmationUrl) {
      throw ShopifyApiError.unavailable(
        'Shopify did not return a subscription to confirm.',
      );
    }

    return {
      subscriptionGid: result.appSubscription.id,
      confirmationUrl: result.confirmationUrl,
    };
  }

  /**
   * Ask Shopify what a subscription's status actually is.
   *
   * Used on the confirmation return rather than trusting the redirect: the
   * merchant lands back on our URL whether they accepted or declined, and the
   * query string is not a signature.
   */
  async fetchSubscription(
    shop: Shop,
    subscriptionGid: string,
  ): Promise<ShopifySubscriptionState | null> {
    const data = await this.client.request<{
      node: {
        id: string;
        status: string;
        name: string;
        test: boolean;
        trialDays: number;
        currentPeriodEnd: string | null;
        createdAt: string;
      } | null;
    }>({
      ...this.credentials(shop),
      estimatedCost: 5,
      query: APP_SUBSCRIPTION_QUERY,
      variables: { id: subscriptionGid },
    });

    if (!data.node) return null;
    return {
      subscriptionGid: data.node.id,
      status: data.node.status,
      name: data.node.name,
      test: data.node.test,
      trialDays: data.node.trialDays,
      currentPeriodEnd: data.node.currentPeriodEnd,
      createdAt: data.node.createdAt,
    };
  }

  /** Cancel a charge. Shopify does this itself on a replacement, so this is
   * only for a merchant cancelling outright. */
  async cancelSubscription(
    shop: Shop,
    subscriptionGid: string,
  ): Promise<{ cancelled: boolean; error: string | null }> {
    const data = await this.client.request<{
      appSubscriptionCancel: {
        appSubscription: { id: string; status: string } | null;
        userErrors: { message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10,
      query: APP_SUBSCRIPTION_CANCEL_MUTATION,
      variables: { id: subscriptionGid },
    });

    const errors = data.appSubscriptionCancel.userErrors;
    if (errors.length > 0) {
      return {
        cancelled: false,
        error: errors.map((error) => error.message).join('; '),
      };
    }
    return {
      cancelled: data.appSubscriptionCancel.appSubscription !== null,
      error: null,
    };
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
    barcode: node.barcode,
    // Through parseMoney, so a price that is not exact decimal money fails
    // here rather than silently becoming a float three layers down.
    price: parseMoney(node.price, 'variant.price'),
    compareAtPrice:
      node.compareAtPrice === null
        ? null
        : parseMoney(node.compareAtPrice, 'variant.compareAtPrice'),
    // Already in the GraphQL selection and previously discarded here.
    inventoryQuantity: node.inventoryQuantity,
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
    // Not selected by the catalog query: nothing in target resolution matches
    // on barcode, and a field per variant across a whole catalogue is a real
    // cost against Shopify's query budget for no reader.
    barcode: null,
    price: parseMoney(edge.node.price, 'variant.price'),
    inventoryQuantity: edge.node.inventoryQuantity,
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
  barcode
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
    edges { node { id title sku price compareAtPrice inventoryQuantity } }
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

const APP_SUBSCRIPTION_CREATE_MUTATION = `
  mutation CreateAppSubscription(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: $lineItems
    ) {
      appSubscription { id status }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

const APP_SUBSCRIPTION_QUERY = `
  query AppSubscription($id: ID!) {
    node(id: $id) {
      ... on AppSubscription {
        id
        status
        name
        test
        trialDays
        currentPeriodEnd
        createdAt
      }
    }
  }
`;

const APP_SUBSCRIPTION_CANCEL_MUTATION = `
  mutation CancelAppSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const VARIANTS_BULK_UPDATE_MUTATION = `
  mutation UpdateVariantPrices(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const PRODUCT_TAGS_UPDATE_MUTATION = `
  mutation UpdateProductTags($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id }
      userErrors { field message }
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
