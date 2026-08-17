import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignPriceSource,
  type CampaignAdjustment,
} from '../domain/campaign.js';
import {
  ZERO,
  add,
  compare,
  equals,
  isNegative,
  parseMoney,
  percentOf,
  subtract,
  type Money,
} from '../money/money.js';
import {
  DEFAULT_PRICE_ENDING_STRATEGY,
  applyPriceEnding,
  type PriceEndingStrategy,
} from '../money/rounding.js';

/**
 * The one place a new price is worked out.
 *
 * Both sides run this: the admin UI to render the preview table, and the API
 * to produce the numbers it actually writes to `price_changes` and sends to
 * Shopify. Sharing the function is what guarantees the preview a merchant
 * approves is the price they get.
 *
 * It does **not** weaken the rule that client prices are never trusted. The
 * server recalculates from its own inputs and ignores whatever the browser
 * computed; sharing the code only means the two agree when the inputs do.
 *
 * Pure — no clock, no I/O, no randomness. Everything it needs is an argument.
 */

export interface PriceCalculationInput {
  /**
   * What the variant costs right now on Shopify. This is the value being
   * replaced, and the one that moves into compare-at when `setCompareAt` is on.
   */
  currentPrice: Money;
  /** The variant's current compare-at, if it already has one. */
  currentCompareAtPrice?: Money | null;
  /**
   * The number the adjustment is computed from. Equal to `currentPrice` for an
   * ordinary campaign; the compare-at price when `basis` is COMPARE_AT_PRICE;
   * the supplier's price for a SHEET campaign. Use {@link resolveBasePrice}.
   */
  basePrice: Money;
  /** Null means "apply the base price unchanged" — a plain supplier sheet. */
  adjustment?: CampaignAdjustment | null;
  /** Charm-pricing ending such as `0.99`. Null means no rounding. */
  roundTo?: Money | null;
  roundStrategy?: PriceEndingStrategy;
  /** Move the old price into compare-at to show a storefront strikethrough. */
  setCompareAt?: boolean;
  /**
   * Floor. A percentage decrease over 100%, or a fixed amount larger than the
   * price, would otherwise produce a negative price and Shopify would reject
   * the mutation mid-batch. Defaults to zero.
   */
  minPrice?: Money;
}

export type PriceCalculationOutcome =
  /** A new price was produced and it differs from the current one. */
  | 'CHANGED'
  /** The maths ran but landed on the price the variant already has. */
  | 'UNCHANGED'
  /** The result fell below `minPrice` and was clamped to it. */
  | 'FLOORED';

export type PriceCalculationWarning =
  /**
   * Rounding moved the price *against* the adjustment's direction — a
   * discount that ended up higher than the price it was discounting, or an
   * increase that ended up lower.
   *
   * The UP strategy causes this whenever the discount is smaller than the gap
   * to the next charm ending: rounding 11.00 up to a `.99` ending gives 11.99,
   * so a campaign with rounding on and no adjustment *raises* prices. The
   * caller decides what to do — the preview flags it, and NEAREST avoids it.
   */
  | 'ROUNDING_OPPOSED_DIRECTION'
  /**
   * `setCompareAt` was on but writing one would not have shown a saving, so
   * it was left alone rather than striking through a number at or below what
   * the customer pays.
   */
  | 'COMPARE_AT_SUPPRESSED';

export interface PriceCalculationResult {
  newPrice: Money;
  newCompareAtPrice: Money | null;
  outcome: PriceCalculationOutcome;
  /** False when nothing needs to be written or sent to Shopify. */
  changed: boolean;
  /** Non-fatal observations the caller may surface or act on. */
  warnings: PriceCalculationWarning[];
}

/**
 * Should this row be written to Shopify, or recorded as SKIPPED?
 *
 * A floored price is a price the merchant did not agree to — either the
 * campaign asked for more off than the product costs, or the result fell under
 * the minimum price they set. Writing the floor instead is worse than writing
 * nothing, because the merchant cannot tell the difference between a price
 * chosen and a price clamped. An unchanged row is skipped because there is
 * nothing to send.
 */
export function shouldApply(result: PriceCalculationResult): boolean {
  return result.changed && result.outcome !== 'FLOORED';
}

/**
 * Why a row came out the way it did, in words for the merchant.
 *
 * Shared rather than written per screen. The preview, the sheet approval and
 * the activation record all describe the same calculation, and three copies of
 * this text is three chances for the reason a variant was skipped to be
 * reported differently depending on which screen the merchant happens to be
 * looking at.
 *
 * Null means there is nothing worth saying.
 */
export function describeOutcome(
  result: PriceCalculationResult,
  options: { hasMerchantFloor?: boolean } = {},
): string | null {
  if (result.outcome === 'FLOORED') {
    // Two different causes, and the merchant can act on one of them. Saying
    // "larger than the price" to someone who set a £5 floor sends them looking
    // for a bug in their discount.
    return options.hasMerchantFloor
      ? 'This would have gone below your minimum price, so this variant is left alone.'
      : 'The discount is larger than the price, so this variant is left alone.';
  }
  if (result.outcome === 'UNCHANGED') {
    return 'Already at this price.';
  }
  if (result.warnings.includes('ROUNDING_OPPOSED_DIRECTION')) {
    return 'Rounding moved this price against the discount — try rounding to nearest.';
  }
  if (result.warnings.includes('COMPARE_AT_SUPPRESSED')) {
    return 'No compare-at was set, because it would not have shown a saving.';
  }
  return null;
}

/**
 * Pick the number the adjustment applies to.
 *
 * A SHEET campaign ignores `basis` entirely — the supplier's price *is* the
 * base, which is the whole point of the sheet. Returns null when the campaign
 * cannot be priced for this variant (compare-at basis on a variant with no
 * compare-at, or a sheet row with no price); the caller skips it.
 */
export function resolveBasePrice(params: {
  priceSource: CampaignPriceSource;
  basis: CampaignBasis;
  currentPrice: Money;
  currentCompareAtPrice: Money | null;
  sheetPrice?: Money | null;
}): Money | null {
  if (params.priceSource === CampaignPriceSource.SHEET) {
    return params.sheetPrice ?? null;
  }
  return params.basis === CampaignBasis.COMPARE_AT_PRICE
    ? params.currentCompareAtPrice
    : params.currentPrice;
}

/** Apply a campaign's adjustment to a base price. Exported for testing. */
export function applyAdjustment(
  basePrice: Money,
  adjustment: CampaignAdjustment,
): Money {
  const delta =
    adjustment.unit === CampaignAdjustmentUnit.PERCENTAGE
      ? percentOf(basePrice, adjustment.value)
      : parseMoney(adjustment.value, 'adjustment.value');

  return adjustment.direction === CampaignAdjustmentDirection.INCREASE
    ? add(basePrice, delta)
    : subtract(basePrice, delta);
}

export function calculatePrice(
  input: PriceCalculationInput,
): PriceCalculationResult {
  const currentPrice = parseMoney(input.currentPrice, 'currentPrice');
  const currentCompareAtPrice =
    input.currentCompareAtPrice == null
      ? null
      : parseMoney(input.currentCompareAtPrice, 'currentCompareAtPrice');
  const basePrice = parseMoney(input.basePrice, 'basePrice');
  const minPrice = parseMoney(input.minPrice ?? ZERO, 'minPrice');

  if (isNegative(basePrice)) {
    throw new RangeError(`basePrice must not be negative: ${basePrice}`);
  }

  const warnings: PriceCalculationWarning[] = [];

  const adjusted = input.adjustment
    ? applyAdjustment(basePrice, input.adjustment)
    : basePrice;
  let newPrice = adjusted;

  if (input.roundTo != null) {
    // Round only what the floor will not immediately override.
    newPrice =
      compare(newPrice, minPrice) < 0
        ? newPrice
        : applyPriceEnding(
            newPrice,
            parseMoney(input.roundTo, 'roundTo'),
            input.roundStrategy ?? DEFAULT_PRICE_ENDING_STRATEGY,
          );

    if (opposedDirection(basePrice, adjusted, newPrice)) {
      warnings.push('ROUNDING_OPPOSED_DIRECTION');
    }
  }

  let floored = false;
  if (compare(newPrice, minPrice) < 0) {
    newPrice = minPrice;
    floored = true;
  }

  /*
   * Compare-at is only worth setting when it would show a genuine
   * strikethrough. Writing a compare-at at or below the new price makes
   * Shopify render a crossed-out number that is not a saving, so an
   * unhelpful campaign configuration is dropped rather than displayed.
   */
  let newCompareAtPrice = currentCompareAtPrice;
  if (input.setCompareAt) {
    if (compare(currentPrice, newPrice) > 0) {
      newCompareAtPrice = currentPrice;
    } else {
      warnings.push('COMPARE_AT_SUPPRESSED');
    }
  }

  const priceMoved = !equals(newPrice, currentPrice);
  const compareAtMoved =
    (newCompareAtPrice === null) !== (currentCompareAtPrice === null) ||
    (newCompareAtPrice !== null &&
      currentCompareAtPrice !== null &&
      !equals(newCompareAtPrice, currentCompareAtPrice));

  const changed = priceMoved || compareAtMoved;

  return {
    newPrice,
    newCompareAtPrice,
    outcome: floored ? 'FLOORED' : changed ? 'CHANGED' : 'UNCHANGED',
    changed,
    warnings,
  };
}

/**
 * Did rounding push the price back past where the adjustment left it, relative
 * to the base? A decrease that rounds up above the base price, or an increase
 * that rounds down below it.
 */
function opposedDirection(
  basePrice: Money,
  adjusted: Money,
  rounded: Money,
): boolean {
  const adjustmentDirection = compare(adjusted, basePrice);
  if (adjustmentDirection === 0) {
    /*
     * No adjustment, so there is no direction to oppose — but rounding that
     * *raises* a price is still a surprise worth flagging, because UP is the
     * default and a merchant who only asked to tidy their price endings did
     * not ask for an increase. Rounding down is exactly what they asked for.
     */
    return compare(rounded, basePrice) > 0;
  }
  const roundedDirection = compare(rounded, basePrice);
  return roundedDirection !== 0 && roundedDirection !== adjustmentDirection;
}
