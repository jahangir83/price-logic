import { Injectable, Logger } from '@nestjs/common';
import {
  CampaignIncludeMode,
  CampaignTargetMode,
  CampaignTargetType,
  ShopifyProductStatus,
} from '@pricelogic/shared';
import {
  DEFAULT_RESOLUTION_LIMIT,
  ShopifyAdminService,
  type CatalogVariant,
} from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import type {
  CampaignTargetingRules,
  ResolvedTargeting,
} from '../target-resolution';

/** Resolution, plus the variants themselves so the preview needs no refetch. */
export interface ResolvedTargetingWithVariants extends ResolvedTargeting {
  variants: CatalogVariant[];
}

/**
 * Turns a campaign's targeting into the variants it actually covers.
 *
 * Implements the contract fixed in Phase 3 (`target-resolution.ts`). The order
 * of operations there is not cosmetic — each step changes the answer:
 *
 *   start set → drop draft/archived → subtract exclusions
 *
 * **Collection membership is resolved now, not when the campaign was created.**
 * A product added to a targeted collection yesterday is included today. That is
 * the behaviour merchants expect from a collection — it is a live set, not a
 * snapshot of one — and it is why this runs at activation rather than storing a
 * variant list at save time.
 */
@Injectable()
export class TargetResolverService {
  private readonly logger = new Logger(TargetResolverService.name);

  constructor(private readonly shopify: ShopifyAdminService) {}

  async resolve(
    shop: Shop,
    rules: CampaignTargetingRules,
    options: { limit?: number } = {},
  ): Promise<ResolvedTargetingWithVariants> {
    const limit = options.limit ?? DEFAULT_RESOLUTION_LIMIT;

    const { variants: startSet, truncated } = await this.buildStartSet(
      shop,
      rules,
      limit,
    );

    // Deduplicate first: a variant can arrive from a collection *and* a tag,
    // and counting it twice would inflate the quota check into a false
    // plan-limit rejection.
    const byId = new Map<string, CatalogVariant>();
    for (const variant of startSet) {
      byId.set(variant.variantId, variant);
    }

    let candidates = [...byId.values()];
    const beforeExclusions = candidates.length;

    /*
     * Draft and archived are dropped independently of `exclusionsEnabled`.
     * It is a blanket safety setting, not one of the merchant's exclusion
     * rules — turning the exclusion list off must not start repricing
     * archived products.
     */
    if (rules.excludeDraftArchived) {
      candidates = candidates.filter(
        (variant) => variant.productStatus === ShopifyProductStatus.ACTIVE,
      );
    }

    if (rules.exclusionsEnabled) {
      const excludeRows = rules.targets.filter(
        (target) => target.mode === CampaignTargetMode.EXCLUDE,
      );
      if (excludeRows.length > 0) {
        const excludedIds = await this.resolveExcludedIds(
          shop,
          excludeRows,
          limit,
        );
        // Exclusions always win — the constitution's rule, applied last so
        // nothing can add a variant back afterwards.
        candidates = candidates.filter(
          (variant) =>
            !excludedIds.variantIds.has(variant.variantId) &&
            !excludedIds.productIds.has(variant.productId) &&
            !matchesFacet(variant, excludeRows),
        );
      }
    }

    const productIds = [
      ...new Set(candidates.map((variant) => variant.productId)),
    ];

    this.logger.debug(
      `Resolved ${candidates.length} variant(s) across ${productIds.length} product(s) for shop ${shop.id}`,
    );

    return {
      variants: candidates,
      variantIds: candidates.map((variant) => variant.variantId),
      productIds,
      excludedVariantCount: beforeExclusions - candidates.length,
      truncated,
    };
  }

  /** ALL_PRODUCTS starts from the catalog; SPECIFIC from the INCLUDE rows. */
  private async buildStartSet(
    shop: Shop,
    rules: CampaignTargetingRules,
    limit: number,
  ): Promise<{ variants: CatalogVariant[]; truncated: boolean }> {
    if (rules.includeMode === CampaignIncludeMode.ALL_PRODUCTS) {
      return this.shopify.listVariantsMatching(shop, null, { limit });
    }

    const includeRows = rules.targets.filter(
      (target) => target.mode === CampaignTargetMode.INCLUDE,
    );
    if (includeRows.length === 0) {
      // SPECIFIC with nothing chosen covers nothing. Returning the whole
      // catalog here would be catastrophic and is exactly the mistake a
      // "default to everything" fallback would make.
      return { variants: [], truncated: false };
    }

    const collected: CatalogVariant[] = [];
    let truncated = false;

    // The INCLUDE rows are a union: a merchant picking a vendor *and* a
    // collection means "either", not "both".
    const productIds = valuesOf(includeRows, CampaignTargetType.PRODUCT);
    if (productIds.length > 0) {
      collected.push(
        ...(await this.shopify.listProductVariants(shop, productIds)),
      );
    }

    for (const collectionId of valuesOf(
      includeRows,
      CampaignTargetType.COLLECTION,
    )) {
      const page = await this.shopify.listCollectionVariants(
        shop,
        collectionId,
        {
          limit,
        },
      );
      collected.push(...page.variants);
      truncated = truncated || page.truncated;
    }

    const facetQuery = buildFacetQuery(includeRows);
    if (facetQuery) {
      const page = await this.shopify.listVariantsMatching(shop, facetQuery, {
        limit,
      });
      collected.push(...page.variants);
      truncated = truncated || page.truncated;
    }

    const variantIds = valuesOf(includeRows, CampaignTargetType.VARIANT);
    if (variantIds.length > 0) {
      const records = await this.shopify.fetchVariantPrices(shop, variantIds);
      // A directly named variant carries no product facets; treat it as ACTIVE
      // with no tags so `excludeDraftArchived` cannot silently drop it. The
      // merchant named this exact variant, which is a stronger signal than a
      // blanket status filter.
      collected.push(
        ...records.map((record) => ({
          ...record,
          productStatus: ShopifyProductStatus.ACTIVE,
          productTags: [],
          productVendor: null,
          productType: null,
        })),
      );
    }

    return { variants: collected, truncated };
  }

  /**
   * The id-based exclusions, resolved to concrete ids.
   *
   * Facet exclusions (tag, vendor, type) are matched in memory against the
   * facets already carried on each variant, so they cost no extra query.
   */
  private async resolveExcludedIds(
    shop: Shop,
    excludeRows: CampaignTargetingRules['targets'],
    limit: number,
  ): Promise<{ variantIds: Set<string>; productIds: Set<string> }> {
    const variantIds = new Set(
      valuesOf(excludeRows, CampaignTargetType.VARIANT),
    );
    const productIds = new Set(
      valuesOf(excludeRows, CampaignTargetType.PRODUCT),
    );

    for (const collectionId of valuesOf(
      excludeRows,
      CampaignTargetType.COLLECTION,
    )) {
      const page = await this.shopify.listCollectionVariants(
        shop,
        collectionId,
        {
          limit,
        },
      );
      for (const variant of page.variants) {
        productIds.add(variant.productId);
      }
    }

    return { variantIds, productIds };
  }
}

function valuesOf(
  targets: CampaignTargetingRules['targets'],
  type: CampaignTargetType,
): string[] {
  return targets
    .filter((target) => target.targetType === type)
    .map((target) => target.targetValue);
}

/**
 * Tag, vendor and product-type rows as one Shopify search query.
 *
 * Joined with OR because the include side is a union. Values are quoted and
 * escaped — a vendor called `O'Neill` would otherwise break the query.
 */
function buildFacetQuery(
  targets: CampaignTargetingRules['targets'],
): string | null {
  const clauses: string[] = [];
  const add = (field: string, type: CampaignTargetType) => {
    for (const value of valuesOf(targets, type)) {
      clauses.push(`${field}:'${value.replace(/(['\\])/g, '\\$1')}'`);
    }
  };

  add('tag', CampaignTargetType.TAG);
  add('vendor', CampaignTargetType.VENDOR);
  add('product_type', CampaignTargetType.PRODUCT_TYPE);

  return clauses.length > 0 ? clauses.join(' OR ') : null;
}

/**
 * Does this variant match any facet exclusion?
 *
 * Case-insensitive, because Shopify treats tags, vendors and types that way
 * for lookup and a merchant excluding "Sale" means products tagged "sale" too.
 */
function matchesFacet(
  variant: CatalogVariant,
  excludeRows: CampaignTargetingRules['targets'],
): boolean {
  const lower = (value: string | null) => value?.toLowerCase() ?? null;
  const tags = new Set(variant.productTags.map((tag) => tag.toLowerCase()));

  return excludeRows.some((row) => {
    const value = row.targetValue.toLowerCase();
    switch (row.targetType) {
      case CampaignTargetType.TAG:
        return tags.has(value);
      case CampaignTargetType.VENDOR:
        return lower(variant.productVendor) === value;
      case CampaignTargetType.PRODUCT_TYPE:
        return lower(variant.productType) === value;
      default:
        return false;
    }
  });
}
