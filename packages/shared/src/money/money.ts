/**
 * Exact decimal money, shared by the API and the admin UI.
 *
 * The constitution forbids JS floats for currency end to end. `0.1 + 0.2`
 * is `0.30000000000000004`, and a 20% discount computed in the browser that
 * disagrees with the same discount computed on the server by one ten-thousandth
 * is a merchant support ticket. Every value here is a decimal *string* in the
 * exact shape PostgreSQL `numeric(19,4)` returns, and every operation runs on
 * `bigint` minor units, so no intermediate result is ever a float.
 *
 * The scale is fixed at 4 to match the column definition. Shopify itself
 * accepts 2 decimal places for most currencies; the extra two exist so a
 * percentage adjustment does not lose precision before rounding.
 */

/**
 * A decimal string with up to 15 integer digits and up to 4 decimal places —
 * the exact domain of `numeric(19,4)`.
 *
 * Deliberately a plain `string` alias rather than a branded type: entity
 * fields, `pg` driver output and JSON payloads all produce plain strings, and
 * a brand would force a cast at every one of those boundaries for no real
 * safety gain. Guard with {@link isMoney} at the edges instead.
 */
export type Money = string;

/** Decimal places carried by every Money value. Matches `numeric(19,4)`. */
export const MONEY_SCALE = 4;

/** Maximum integer digits. 15 + 4 = the 19 of `numeric(19,4)`. */
export const MONEY_PRECISION = 19;

const FACTOR = 10n ** BigInt(MONEY_SCALE);
const MAX_INTEGER_DIGITS = MONEY_PRECISION - MONEY_SCALE;
const MONEY_PATTERN = new RegExp(
  `^-?\\d{1,${MAX_INTEGER_DIGITS}}(?:\\.\\d{1,${MONEY_SCALE}})?$`,
);

/** Zero, in canonical form. */
export const ZERO: Money = '0.0000';

/** Thrown when a value that must be Money is not. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Type guard for values arriving from outside — request bodies, CSV cells,
 * Shopify responses. Accepts `10`, `10.5`, `-3.25`, `0.0001`; rejects
 * `10.00001`, `1e3`, `$10`, `` and anything non-finite.
 */
export function isMoney(value: unknown): value is Money {
  return typeof value === 'string' && MONEY_PATTERN.test(value);
}

/**
 * Normalise an untrusted decimal string to canonical 4-decimal form.
 * `'10'` and `'10.5'` both become `'10.0000'` / `'10.5000'`.
 *
 * Throws rather than returning null: a price that cannot be parsed must never
 * silently become zero.
 */
export function parseMoney(value: unknown, field = 'value'): Money {
  if (!isMoney(value)) {
    throw new MoneyError(
      `${field} is not a valid money string: ${JSON.stringify(value)}`,
    );
  }
  return fromMinor(toMinor(value));
}

/**
 * Same as {@link parseMoney} but returns null instead of throwing — for CSV
 * parsing, where one bad cell marks a row INVALID and the file continues.
 */
export function tryParseMoney(value: unknown): Money | null {
  return isMoney(value) ? fromMinor(toMinor(value)) : null;
}

/** Money → scaled integer. `'10.50'` → `105000n`. */
export function toMinor(value: Money): bigint {
  if (!isMoney(value)) {
    throw new MoneyError(
      `not a valid money string: ${JSON.stringify(value)}`,
    );
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = fraction.padEnd(MONEY_SCALE, '0');
  const minor = BigInt(whole) * FACTOR + BigInt(padded);
  return negative ? -minor : minor;
}

/** Scaled integer → canonical Money. `105000n` → `'10.5000'`. */
export function fromMinor(minor: bigint): Money {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(MONEY_SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Integer division rounding half away from zero.
 *
 * Half-up rather than banker's rounding because that is what merchants and
 * spreadsheets expect: 2.5 → 3, not 2. The denominator must be positive.
 */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function add(a: Money, b: Money): Money {
  return fromMinor(toMinor(a) + toMinor(b));
}

export function subtract(a: Money, b: Money): Money {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** Multiply by another decimal, rounding the result to 4 places. */
export function multiply(a: Money, multiplier: Money): Money {
  return fromMinor(divideRoundHalfUp(toMinor(a) * toMinor(multiplier), FACTOR));
}

/** Divide by another decimal, rounding the result to 4 places. */
export function divide(a: Money, divisor: Money): Money {
  const divisorMinor = toMinor(divisor);
  if (divisorMinor === 0n) {
    throw new MoneyError('division by zero');
  }
  return fromMinor(divideRoundHalfUp(toMinor(a) * FACTOR, divisorMinor));
}

/**
 * `percent` percent of `a`. `percentOf('100.00', '12.5')` → `'12.5000'`.
 *
 * Computed as `a × percent ÷ 100` in one bigint expression so the division
 * rounds once, at the end, rather than twice.
 */
export function percentOf(a: Money, percent: Money): Money {
  return fromMinor(
    divideRoundHalfUp(toMinor(a) * toMinor(percent), FACTOR * 100n),
  );
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  const left = toMinor(a);
  const right = toMinor(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return compare(a, b) === 0;
}

export function isZero(value: Money): boolean {
  return toMinor(value) === 0n;
}

export function isNegative(value: Money): boolean {
  return toMinor(value) < 0n;
}

export function isPositive(value: Money): boolean {
  return toMinor(value) > 0n;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? fromMinor(toMinor(a)) : fromMinor(toMinor(b));
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? fromMinor(toMinor(a)) : fromMinor(toMinor(b));
}

export function absolute(value: Money): Money {
  const minor = toMinor(value);
  return fromMinor(minor < 0n ? -minor : minor);
}

export function negate(value: Money): Money {
  return fromMinor(-toMinor(value));
}

/**
 * Drop to the 2 decimal places Shopify stores, rounding half up.
 *
 * Call this immediately before a Shopify mutation and before writing
 * `price_changes.new_price`, so what we record is what the storefront shows.
 * Zero-decimal currencies (JPY, KRW) are not handled — MVP is 2-decimal only.
 */
export function toShopifyPrice(value: Money): string {
  const cents = divideRoundHalfUp(toMinor(value), 100n);
  const negative = cents < 0n;
  const absoluteCents = negative ? -cents : cents;
  const whole = absoluteCents / 100n;
  const fraction = (absoluteCents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Human-readable, for display only — never feed the result back into a
 * calculation or send it to Shopify.
 */
export function formatMoney(
  value: Money,
  currency: string,
  locale?: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(Number(toShopifyPrice(value)));
}
