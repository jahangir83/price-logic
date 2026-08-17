import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignPriceSource,
  compare,
  isMoney,
  type Money,
} from '@pricelogic/shared';

/**
 * The cross-field rules a campaign must satisfy.
 *
 * Pure functions returning a message or null, so they can be table-tested
 * without a DI container and reused by the DTO validators, the service and
 * (later) the sheet-approval path that builds a campaign server-side.
 *
 * The database enforces the same invariants with CHECK constraints. These
 * exist so a merchant gets a sentence explaining what is wrong instead of a
 * 500 from a constraint violation — not as the only line of defence.
 */

export interface AdjustmentInput {
  adjustmentUnit?: CampaignAdjustmentUnit | null;
  adjustmentDirection?: CampaignAdjustmentDirection | null;
  adjustmentValue?: Money | null;
}

export interface ScheduleInput {
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  startTimezone?: string;
  endTimezone?: string;
}

export interface PriceSourceInput {
  priceSource?: CampaignPriceSource;
  csvImportId?: string | null;
  targets?: unknown[];
}

/**
 * The adjustment is all-or-nothing.
 *
 * Null for all three means "apply the base price unchanged", which is what a
 * plain supplier sheet does — so absence is a valid configuration, not a
 * missing field.
 */
export function validateAdjustment(input: AdjustmentInput): string | null {
  const present = [
    input.adjustmentUnit,
    input.adjustmentDirection,
    input.adjustmentValue,
  ].filter((value) => value !== null && value !== undefined);

  if (present.length === 0) return null;
  if (present.length !== 3) {
    return 'An adjustment needs a unit, a direction and a value, or none of the three.';
  }

  const value = input.adjustmentValue as Money;
  if (!isMoney(value)) {
    return 'The adjustment value must be a number with up to four decimal places.';
  }
  if (compare(value, '0') <= 0) {
    // Zero is rejected rather than treated as "no adjustment": a merchant who
    // typed 0 meant something, and silently doing nothing hides the mistake.
    return 'The adjustment value must be greater than zero.';
  }
  if (
    input.adjustmentUnit === CampaignAdjustmentUnit.PERCENTAGE &&
    input.adjustmentDirection === CampaignAdjustmentDirection.DECREASE &&
    compare(value, '100') > 0
  ) {
    return 'A percentage decrease cannot be more than 100%.';
  }
  if (
    input.adjustmentUnit === CampaignAdjustmentUnit.PERCENTAGE &&
    compare(value, '10000') > 0
  ) {
    // A 100,000% increase is a typo, not a pricing strategy.
    return 'A percentage adjustment cannot be more than 10,000%.';
  }
  return null;
}

/** `Intl` is the only reliable IANA check; an unknown zone throws. */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedule rules.
 *
 * **`endAt` is optional and that is deliberate**, against this phase's own
 * original recommendation. The app's campaign types include a permanent
 * repricing ("increase everything 5%"), which has no end date by definition;
 * requiring one would make the merchant invent a date and then be surprised
 * when their prices revert. The reference app agrees — its `endDate` is
 * nullable too. A campaign with no `endAt` simply never auto-reverts and must
 * be deactivated by hand, which the UI states plainly.
 *
 * `startAt` may be null: that means "start when I activate it", not "invalid".
 */
export function validateSchedule(
  input: ScheduleInput,
  options: { isCreate?: boolean; now?: Date } = {},
): string | null {
  const now = options.now ?? new Date();
  const startAt = toDate(input.startAt);
  const endAt = toDate(input.endAt);

  if (input.startAt != null && startAt === null) {
    return 'The start date is not a valid date.';
  }
  if (input.endAt != null && endAt === null) {
    return 'The end date is not a valid date.';
  }
  if (input.startTimezone && !isValidTimezone(input.startTimezone)) {
    return `“${input.startTimezone}” is not a recognised time zone.`;
  }
  if (input.endTimezone && !isValidTimezone(input.endTimezone)) {
    return `“${input.endTimezone}” is not a recognised time zone.`;
  }
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    return 'The end date must be after the start date.';
  }
  if (options.isCreate && startAt && startAt.getTime() < now.getTime()) {
    // A minute of slack: the merchant picked "now" and the form took a moment
    // to submit, which is not the same as scheduling something in the past.
    const slackMs = 60_000;
    if (now.getTime() - startAt.getTime() > slackMs) {
      return 'The start date cannot be in the past.';
    }
  }
  return null;
}

/**
 * A sheet campaign takes its prices and its scope from the file.
 *
 * Targets are rejected rather than ignored: a merchant who set both believes
 * the targets apply, and silently discarding them would price products they
 * did not expect.
 */
export function validatePriceSource(input: PriceSourceInput): string | null {
  const source = input.priceSource ?? CampaignPriceSource.SHOPIFY_CURRENT;

  if (source === CampaignPriceSource.SHEET) {
    if (!input.csvImportId) {
      return 'A sheet campaign must reference the uploaded file it prices from.';
    }
    if (input.targets && input.targets.length > 0) {
      return 'A sheet campaign is scoped by the file’s SKUs, so it cannot also have targets.';
    }
    return null;
  }

  if (input.csvImportId) {
    return 'Only a sheet campaign can reference an uploaded file.';
  }
  return null;
}

/** Every rule at once, for the service and the DTO validator to share. */
export function validateCampaign(
  input: AdjustmentInput & ScheduleInput & PriceSourceInput,
  options: { isCreate?: boolean; now?: Date } = {},
): string | null {
  return (
    validateAdjustment(input) ??
    validateSchedule(input, options) ??
    validatePriceSource(input)
  );
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
