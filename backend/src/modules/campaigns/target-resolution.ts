import type {
  CampaignIncludeMode,
  CampaignTargetMode,
  CampaignTargetType,
} from '@pricelogic/shared';

/**
 * The contract for turning a campaign's targeting into a list of variants.
 *
 * **Defined here, implemented in Phase 4.** The contract is fixed now because
 * two phases depend on agreeing about it: this phase builds the UI that
 * produces the rules, and Phase 4 writes the resolver that consumes them. If
 * the meaning of `exclusionsEnabled` were settled while writing the resolver,
 * the form would already have shipped a different meaning.
 *
 * ## The rules, in order
 *
 * 1. **Start set.** `includeMode = ALL_PRODUCTS` starts from the shop's whole
 *    catalog. `SPECIFIC` starts from the union of the INCLUDE rows — union,
 *    not intersection: a merchant who picks a vendor *and* a collection means
 *    "either", which is how every picker in the reference app behaves.
 *
 * 2. **Draft and archived.** `excludeDraftArchived` removes products that are
 *    not ACTIVE. It applies **independently of `exclusionsEnabled`** — it is a
 *    blanket safety setting, not one of the merchant's exclusion rules, and
 *    turning off the exclusion list must not start repricing archived
 *    products.
 *
 * 3. **Exclusions.** `exclusionsEnabled` gates the EXCLUDE rows as a group, so
 *    a merchant can switch their exclusion list off without deleting it. When
 *    enabled, every EXCLUDE row is subtracted.
 *
 * 4. **Exclusions always win.** A variant matching both an INCLUDE and an
 *    EXCLUDE row is out. This is the constitution's rule and is not
 *    negotiable per-campaign.
 *
 * A SHEET campaign never reaches this resolver: its scope is the file's SKU
 * list, which is why `validatePriceSource` rejects a sheet campaign that also
 * carries targets.
 *
 * ## Collection membership is resolved at activation, not at creation
 *
 * A campaign targeting a collection asks the collection what it contains *at
 * the moment it runs*. A product added to that collection between saving the
 * campaign and starting it **is** included; one removed is not.
 *
 * This is deliberate. A collection is a live set — that is what makes it
 * useful for "everything in Summer Sale" — and freezing its members at save
 * time would make a scheduled campaign quietly price yesterday's catalog.
 * The cost is that a preview and the activation that follows it can differ if
 * the catalog changed in between, which is why the preview is display-only and
 * activation recomputes.
 *
 * Merchants ask about this, so the campaign form says it in as many words.
 *
 * ## Matching, per target type
 *
 * | Type | `targetValue` | Matches |
 * | --- | --- | --- |
 * | `PRODUCT` | product GID | every variant of that product |
 * | `VARIANT` | variant GID | that variant only |
 * | `COLLECTION` | collection GID | every variant of every product in it |
 * | `TAG` | literal tag | every variant of a product carrying it |
 * | `VENDOR` | literal vendor | every variant of a product with it |
 * | `PRODUCT_TYPE` | literal type | every variant of a product with it |
 *
 * TAG, VENDOR and PRODUCT_TYPE compare **case-insensitively**, because Shopify
 * treats them that way for lookup and a merchant who typed "Sale" should not
 * miss products tagged "sale".
 *
 * `VARIANT` is supported on both sides, per the constitution — "this whole
 * collection except the extra-large" is a real request and cannot be expressed
 * at product granularity.
 */

export interface CampaignTargetingRules {
  includeMode: CampaignIncludeMode;
  excludeDraftArchived: boolean;
  exclusionsEnabled: boolean;
  targets: {
    mode: CampaignTargetMode;
    targetType: CampaignTargetType;
    targetValue: string;
  }[];
}

export interface ResolvedTargeting {
  /** Variant GIDs in scope, deduplicated. */
  variantIds: string[];
  /** Products whose tags the campaign may change — a superset of the above. */
  productIds: string[];
  /** How many variants the exclusion rules removed, for the preview summary. */
  excludedVariantCount: number;
  /** True when the result was capped; the preview says so rather than lying. */
  truncated: boolean;
}

export interface TargetResolver {
  resolve(
    shopId: string,
    rules: CampaignTargetingRules,
    options?: { limit?: number },
  ): Promise<ResolvedTargeting>;
}

/**
 * Placeholder so callers can be written and typed against the real contract
 * before Phase 4 lands. Throwing rather than returning an empty set is
 * deliberate: an empty result reads as "nothing matched", and a campaign that
 * silently prices nothing is the worst possible stand-in.
 */
export const UNIMPLEMENTED_TARGET_RESOLVER: TargetResolver = {
  resolve() {
    return Promise.reject(
      new Error(
        'Target resolution is implemented in MVP Phase 4 (see target-resolution.ts for the contract).',
      ),
    );
  },
};
