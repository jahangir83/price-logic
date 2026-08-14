import {
  MONEY_SCALE,
  MoneyError,
  type Money,
  compare,
  fromMinor,
  isNegative,
  toMinor,
} from './money.js';

const ONE = 10n ** BigInt(MONEY_SCALE);

/**
 * How a price is snapped onto a charm-pricing ending.
 *
 * `campaigns.round_to` stores the ending itself (0.99, 0.95, 0.00) but has no
 * companion strategy column, so UP is the schema's implied behaviour — see
 * the note on {@link applyPriceEnding}.
 */
export type PriceEndingStrategy = 'UP' | 'DOWN' | 'NEAREST';

export const DEFAULT_PRICE_ENDING_STRATEGY: PriceEndingStrategy = 'UP';

/**
 * Snap a price onto a charm-pricing ending such as `.99`.
 *
 * `applyPriceEnding('10.20', '0.99')` → `'10.99'`, matching the example
 * recorded on `campaigns.round_to`.
 *
 * **The default is UP, and that is worth knowing before you rely on it.** UP
 * always moves to the next occurrence of the ending, so a 20% discount that
 * lands on exactly `11.00` becomes `11.99` — it gives back most of the
 * discount. NEAREST would make that `10.99`. UP is the default only because
 * it is what the column's documented example describes; there is no
 * `round_strategy` column yet, so a campaign cannot currently choose.
 *
 * @param price   the value to snap; must not be negative
 * @param ending  the fractional ending, `0 <= ending < 1`
 */
export function applyPriceEnding(
  price: Money,
  ending: Money,
  strategy: PriceEndingStrategy = DEFAULT_PRICE_ENDING_STRATEGY,
): Money {
  if (isNegative(price)) {
    throw new MoneyError(`cannot apply a price ending to a negative price: ${price}`);
  }
  if (isNegative(ending) || compare(ending, '1') >= 0) {
    throw new MoneyError(
      `price ending must be at least 0 and less than 1, got: ${ending}`,
    );
  }

  const priceMinor = toMinor(price);
  const endingMinor = toMinor(ending);

  // Prices are non-negative here, so bigint truncation is already a floor.
  const whole = priceMinor / ONE;
  const below = whole * ONE + endingMinor;
  const candidate = below <= priceMinor ? below : below - ONE;
  const above = candidate + ONE;

  if (candidate === priceMinor) {
    return fromMinor(priceMinor);
  }

  switch (strategy) {
    case 'DOWN':
      // Never go below zero — 0.40 with a 0.99 ending stays at 0.99.
      return fromMinor(candidate < 0n ? above : candidate);
    case 'NEAREST': {
      const distanceDown = priceMinor - candidate;
      const distanceUp = above - priceMinor;
      if (candidate < 0n) return fromMinor(above);
      // Ties go up, consistent with half-up rounding elsewhere.
      return fromMinor(distanceUp <= distanceDown ? above : candidate);
    }
    case 'UP':
    default:
      return fromMinor(above);
  }
}
