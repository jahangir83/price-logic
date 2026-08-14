import type { Money } from '../money/money.js';
import type { PriceEndingStrategy } from '../money/rounding.js';
import type { Serialized } from '../serialization.js';

/**
 * What happens when two active campaigns target the same variant.
 *
 * Lives here rather than beside the resolver because it is a domain choice
 * stored on both `shops` (the merchant's global default) and `campaigns` (an
 * optional per-campaign override); the resolver in `pricing/overlap.ts` only
 * consumes it.
 */
export enum DuplicatePolicy {
  /**
   * The biggest discount wins — the lowest price. **Default.**
   *
   * Order-independent, so the right price is always recomputable from the set
   * of campaigns currently holding the variant. That is what makes revert
   * tractable when another campaign still owns the variant.
   */
  HIGHEST_DISCOUNT = 'HIGHEST_DISCOUNT',
  /** The most recently activated campaign wins. Order-dependent. */
  LATEST = 'LATEST',
  /** Leave a contested variant untouched and let the merchant resolve it. */
  SKIP = 'SKIP',
}

export const DEFAULT_DUPLICATE_POLICY = DuplicatePolicy.HIGHEST_DISCOUNT;

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Where the base price comes from, before any adjustment is applied. */
export enum CampaignPriceSource {
  /** Read the variant's current price from Shopify at activation. */
  SHOPIFY_CURRENT = 'SHOPIFY_CURRENT',
  /** Take the price from an approved supplier sheet (`csvImportId`). */
  SHEET = 'SHEET',
}

export enum CampaignAdjustmentUnit {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
}

export enum CampaignAdjustmentDirection {
  INCREASE = 'INCREASE',
  DECREASE = 'DECREASE',
}

/** Which of the variant's two prices the adjustment is calculated from. */
export enum CampaignBasis {
  PRICE = 'PRICE',
  COMPARE_AT_PRICE = 'COMPARE_AT_PRICE',
}

export enum CampaignIncludeMode {
  /** Every product in the shop, minus whatever the EXCLUDE targets remove. */
  ALL_PRODUCTS = 'ALL_PRODUCTS',
  /** Only what the INCLUDE targets name, minus the EXCLUDE targets. */
  SPECIFIC = 'SPECIFIC',
}

/**
 * The adjustment a campaign applies on top of its base price.
 *
 * All three fields move together — the database enforces
 * `num_nonnulls(unit, direction, value) IN (0, 3)`, so this is either fully
 * present or absent entirely. Absent means "use the base price unchanged",
 * which is what a plain supplier sheet does.
 */
export interface CampaignAdjustment {
  unit: CampaignAdjustmentUnit;
  direction: CampaignAdjustmentDirection;
  value: Money;
}

/**
 * The container every price change belongs to.
 *
 * There is deliberately no `type` field. "Price increase" and "price decrease"
 * are a *direction*, and a supplier sheet is a *source* — independent axes,
 * which is what lets a sheet carry the merchant's own markup on top of the
 * supplier's price.
 */
export interface Campaign {
  id: string;
  shopId: string;
  title: string;
  status: CampaignStatus;

  priceSource: CampaignPriceSource;
  /** Set when `priceSource` is SHEET; null otherwise. */
  csvImportId: string | null;

  adjustmentUnit: CampaignAdjustmentUnit | null;
  adjustmentDirection: CampaignAdjustmentDirection | null;
  adjustmentValue: Money | null;

  basis: CampaignBasis;
  /** Charm-pricing ending, e.g. `0.99`. Null means the merchant turned rounding off. */
  roundTo: Money | null;
  /** How a price is snapped onto `roundTo`. Ignored when `roundTo` is null. */
  roundStrategy: PriceEndingStrategy;
  setCompareAt: boolean;

  /** Null means "use the shop's global setting". */
  duplicatePolicy: DuplicatePolicy | null;

  includeMode: CampaignIncludeMode;
  excludeDraftArchived: boolean;
  exclusionsEnabled: boolean;

  addTags: string[];
  removeTags: string[];

  startAt: Date | null;
  /** IANA zone name, not an offset. */
  startTimezone: string;
  endAt: Date | null;
  endTimezone: string;

  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CampaignDto = Serialized<Campaign>;

/**
 * Collapse a campaign's three loose adjustment columns into the grouped shape
 * the calculator takes, or null when there is no adjustment.
 *
 * Returns null unless all three are set — a half-specified adjustment cannot
 * reach the database, so reaching here means the value came from an unvalidated
 * request body and must not be treated as an adjustment.
 */
export function toCampaignAdjustment(
  campaign: Pick<
    Campaign,
    'adjustmentUnit' | 'adjustmentDirection' | 'adjustmentValue'
  >,
): CampaignAdjustment | null {
  const { adjustmentUnit, adjustmentDirection, adjustmentValue } = campaign;
  if (
    adjustmentUnit === null ||
    adjustmentDirection === null ||
    adjustmentValue === null
  ) {
    return null;
  }
  return {
    unit: adjustmentUnit,
    direction: adjustmentDirection,
    value: adjustmentValue,
  };
}
