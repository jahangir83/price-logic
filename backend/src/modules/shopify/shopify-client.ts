import { Injectable } from '@nestjs/common';
import type {
  ShopifyCollectionSummary,
  ShopifyPage,
  ShopifyProductSummary,
} from '@pricelogic/shared';
import { Shop } from '../shops/entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import {
  ShopifyAdminService,
  type CatalogVariant,
  type ShopifySubscriptionState,
  type SkuMatch,
  type VariantPriceUpdate,
  type VariantUpdateOutcome,
  type VariantPriceRecord,
} from './shopify-admin.service';
import { ShopifyGraphQlClient } from './shopify-graphql.client';
import {
  WebhookRegistrarService,
  type WebhookRegistrationResult,
} from './webhook-registrar.service';

/**
 * Everything one shop can do, with the shop already bound.
 *
 * `ShopifyAdminService` takes a `Shop` on every call, which is right for the
 * dispatcher — it serves every shop — and tedious everywhere else. A caller
 * working on one merchant gets this instead and stops threading the same
 * argument through six layers.
 *
 * It is a facade, not a second implementation: every method delegates. The
 * point is the *binding*, so there is exactly one place a shop is chosen and
 * no call site can accidentally pass a different one.
 */
export class ShopifyClient {
  constructor(
    readonly shop: Shop,
    private readonly admin: ShopifyAdminService,
    private readonly graphql: ShopifyGraphQlClient,
    private readonly shops: ShopsService,
    private readonly registrar: WebhookRegistrarService,
  ) {}

  get shopDomain(): string {
    return this.shop.shopDomain;
  }

  /**
   * Run an arbitrary Admin GraphQL document.
   *
   * The escape hatch for a query the typed methods do not cover. It still goes
   * through the shared client, so the cost-aware throttle, the retry and the
   * error translation all apply — which is the reason not to reach for `fetch`
   * directly, however tempting for a one-off.
   */
  async gql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    estimatedCost = 50,
  ): Promise<T> {
    return this.graphql.request<T>({
      shopId: this.shop.id,
      shopDomain: this.shop.shopDomain,
      accessToken: this.accessToken(),
      query,
      variables,
      estimatedCost,
    });
  }

  // ---------------------------------------------------------------- catalog

  searchProducts(
    options: { query?: string; first?: number; after?: string | null } = {},
  ): Promise<ShopifyPage<ShopifyProductSummary>> {
    return this.admin.searchProducts(this.shop, options);
  }

  searchCollections(
    options: { query?: string; first?: number; after?: string | null } = {},
  ): Promise<ShopifyPage<ShopifyCollectionSummary>> {
    return this.admin.searchCollections(this.shop, options);
  }

  listTags(first?: number): Promise<string[]> {
    return this.admin.listTags(this.shop, first);
  }

  listVendors(first?: number): Promise<string[]> {
    return this.admin.listVendors(this.shop, first);
  }

  listProductTypes(first?: number): Promise<string[]> {
    return this.admin.listProductTypes(this.shop, first);
  }

  listVariantsMatching(
    query: string | null,
    options: { limit?: number } = {},
  ): Promise<{ variants: CatalogVariant[]; truncated: boolean }> {
    return this.admin.listVariantsMatching(this.shop, query, options);
  }

  listCollectionVariants(
    collectionId: string,
    options: { limit?: number } = {},
  ): Promise<{ variants: CatalogVariant[]; truncated: boolean }> {
    return this.admin.listCollectionVariants(this.shop, collectionId, options);
  }

  listProductVariants(
    productIds: readonly string[],
  ): Promise<CatalogVariant[]> {
    return this.admin.listProductVariants(this.shop, productIds);
  }

  /**
   * Current prices. Uncached by default — see `ShopifyAdminService`; a price
   * read for a write must be the live one.
   */
  fetchVariantPrices(
    variantIds: readonly string[],
    options: { useCache?: boolean } = {},
  ): Promise<VariantPriceRecord[]> {
    return this.admin.fetchVariantPrices(this.shop, variantIds, options);
  }

  findVariantsBySku(skus: readonly string[]): Promise<SkuMatch[]> {
    return this.admin.findVariantsBySku(this.shop, skus);
  }

  // ---------------------------------------------------------------- writes

  updateVariantPrices(
    productId: string,
    variants: readonly VariantPriceUpdate[],
  ): Promise<VariantUpdateOutcome[]> {
    return this.admin.updateVariantPrices(this.shop, productId, variants);
  }

  updateProductTags(
    productId: string,
    tags: readonly string[],
  ): Promise<{ applied: boolean; error: string | null }> {
    return this.admin.updateProductTags(this.shop, productId, tags);
  }

  // ---------------------------------------------------------------- billing

  createSubscription(
    input: Parameters<ShopifyAdminService['createSubscription']>[1],
  ): Promise<{ subscriptionGid: string; confirmationUrl: string }> {
    return this.admin.createSubscription(this.shop, input);
  }

  fetchSubscription(
    subscriptionGid: string,
  ): Promise<ShopifySubscriptionState | null> {
    return this.admin.fetchSubscription(this.shop, subscriptionGid);
  }

  cancelSubscription(
    subscriptionGid: string,
  ): Promise<{ cancelled: boolean; error: string | null }> {
    return this.admin.cancelSubscription(this.shop, subscriptionGid);
  }

  // ---------------------------------------------------------------- install

  /** Subscribe this shop to every topic the app needs. */
  registerWebhooks(accessToken?: string): Promise<WebhookRegistrationResult> {
    return this.registrar.registerAll(
      this.shop,
      accessToken ?? this.accessToken(),
    );
  }

  /** Drop this shop's cached catalog reads. */
  invalidateCache(): void {
    this.admin.invalidate(this.shop.id);
  }

  /**
   * Decrypted on each use and never held on the instance.
   *
   * A long-lived client object holding a plaintext token is a token sitting in
   * a heap dump. Decryption is cheap; keeping it is not.
   */
  private accessToken(): string {
    return this.shops.getDecryptedAccessToken(this.shop);
  }
}

/**
 * Makes a {@link ShopifyClient} for a shop.
 *
 * Injected wherever a caller works on one merchant. Nothing here caches
 * clients — a `Shop` entity carries a token that can be rotated or revoked, so
 * a client outliving the row it was built from would keep using a stale one.
 */
@Injectable()
export class ShopifyClientFactory {
  constructor(
    private readonly admin: ShopifyAdminService,
    private readonly graphql: ShopifyGraphQlClient,
    private readonly shops: ShopsService,
    private readonly registrar: WebhookRegistrarService,
  ) {}

  forShop(shop: Shop): ShopifyClient {
    return new ShopifyClient(
      shop,
      this.admin,
      this.graphql,
      this.shops,
      this.registrar,
    );
  }

  /** For a caller that has only an id — a job payload, say. */
  async forShopId(shopId: string): Promise<ShopifyClient | null> {
    const shop = await this.shops.findById(shopId);
    return shop ? this.forShop(shop) : null;
  }
}
