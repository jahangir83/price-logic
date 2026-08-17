import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PricingStrategy,
  type UpdateStoreSettingsRequest,
} from '@pricelogic/shared';

/** A decimal money string: digits, optionally a point and up to four places. */
const MONEY = /^\d+(\.\d{1,4})?$/;

/**
 * Validates a settings edit.
 *
 * Money arrives as a string and is validated as one, never parsed to a number
 * on the way in. Accepting `0.1` as a float and formatting it back is how a
 * currency value acquires a rounding error before it has been stored.
 */
export class UpdateSettingsDto implements UpdateStoreSettingsRequest {
  @IsOptional()
  @IsEnum(PricingStrategy)
  defaultPricingStrategy?: PricingStrategy;

  @IsOptional()
  @IsNumber()
  @Min(0)
  // A margin at or above 100% is unsatisfiable: it demands a price with no
  // cost in it. Rejecting it here is kinder than a campaign that resolves to
  // nothing later and cannot say why.
  @Max(99.99)
  minimumMarginPercent?: number;

  @IsOptional()
  @Matches(MONEY, {
    message: 'minimumPrice must be a decimal amount, e.g. "0.01"',
  })
  minimumPrice?: string;

  /**
   * Null is meaningful — it is how a merchant removes the ceiling — so the
   * format check is skipped for null rather than the field being optional in
   * a way that cannot express it.
   */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Matches(MONEY, {
    message: 'maximumPrice must be a decimal amount or null',
  })
  maximumPrice?: string | null;

  @IsOptional()
  @IsBoolean()
  skipOutOfStock?: boolean;
}
