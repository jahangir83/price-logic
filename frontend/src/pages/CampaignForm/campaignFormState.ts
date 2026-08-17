import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  CampaignTargetMode,
  CampaignTargetType,
  instantFromLocal,
  localFromInstant,
  localTimeExists,
  type CampaignDto,
  type CampaignTargetDto,
  type CampaignTargetInput,
  type CreateCampaignRequest,
  type Money,
} from '@pricelogic/shared';
import { browserTimezone, nowInZone } from '../../lib/timezones';

/**
 * When the campaign starts.
 *
 * `IMMEDIATELY` is not "startAt = null": the campaign still records when it
 * began, because revert and the results screen both need to say when prices
 * changed. It means the merchant is not choosing a time, so one is taken at
 * save — and taken *in the campaign's zone*, so a merchant in London starting
 * a New York sale gets New York's clock, not their own.
 */
export type ScheduleMode = 'IMMEDIATELY' | 'SCHEDULE';

/**
 * What the form holds while the merchant is editing.
 *
 * Kept separate from `CreateCampaignRequest` because the two genuinely differ:
 * the form needs an explicit "rounding on/off" flag, whereas the API expresses
 * that as `roundTo: null`, and the form tracks target selections per picker
 * where the API takes one flat list. Mapping between them is `toRequest`,
 * which is the only place that difference lives.
 */
export interface CampaignFormState {
  title: string;
  priceSource: CampaignPriceSource;

  adjustmentEnabled: boolean;
  adjustmentUnit: CampaignAdjustmentUnit;
  adjustmentDirection: CampaignAdjustmentDirection;
  adjustmentValue: string;

  basis: CampaignBasis;

  roundingEnabled: boolean;
  roundTo: string;
  roundStrategy: 'UP' | 'DOWN' | 'NEAREST';

  setCompareAt: boolean;

  includeMode: CampaignIncludeMode;
  includeProducts: string[];
  includeCollections: string[];
  includeTags: string[];
  includeVendors: string[];
  includeProductTypes: string[];

  excludeDraftArchived: boolean;
  exclusionsEnabled: boolean;
  excludeProducts: string[];
  excludeCollections: string[];
  excludeTags: string[];
  excludeVendors: string[];
  excludeProductTypes: string[];

  addTags: string[];
  removeTags: string[];

  scheduleMode: ScheduleMode;

  /**
   * Wall-clock time as `YYYY-MM-DDTHH:mm`, meant **in `timezone`** — not in
   * the browser's zone. Reading it with `new Date()` is therefore wrong; go
   * through `instantFromLocal`.
   */
  startAt: string;
  hasEndDate: boolean;
  endAt: string;

  /**
   * One zone for the whole campaign.
   *
   * The API carries `startTimezone` and `endTimezone` separately, but a
   * campaign that starts in Tokyo and ends in Berlin is not a thing a merchant
   * means — it is a way to typo a sale into ending before it starts. Both are
   * sent from this single field.
   */
  timezone: string;
}

export function emptyCampaignForm(): CampaignFormState {
  const timezone = browserTimezone();
  return {
    title: '',
    priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
    adjustmentEnabled: true,
    adjustmentUnit: CampaignAdjustmentUnit.PERCENTAGE,
    adjustmentDirection: CampaignAdjustmentDirection.DECREASE,
    adjustmentValue: '',
    basis: CampaignBasis.PRICE,
    roundingEnabled: false,
    roundTo: '0.99',
    roundStrategy: 'UP',
    setCompareAt: true,
    includeMode: CampaignIncludeMode.ALL_PRODUCTS,
    includeProducts: [],
    includeCollections: [],
    includeTags: [],
    includeVendors: [],
    includeProductTypes: [],
    excludeDraftArchived: true,
    exclusionsEnabled: false,
    excludeProducts: [],
    excludeCollections: [],
    excludeTags: [],
    excludeVendors: [],
    excludeProductTypes: [],
    addTags: [],
    removeTags: [],
    // A new campaign starts now unless the merchant says otherwise: the common
    // case is "put this sale on", not "put this sale on next Tuesday".
    scheduleMode: 'IMMEDIATELY',
    startAt: nowInZone(timezone),
    hasEndDate: false,
    endAt: '',
    // The merchant's own zone, not UTC: "9am" means 9am where they are, and
    // the schedule survives a DST boundary because the zone travels with it.
    timezone,
  };
}

/**
 * A saved campaign, back into the form that edits it.
 *
 * The inverse of {@link toRequest}, and it has to stay that way: a field that
 * round-trips wrongly is worse than one that is missing, because the merchant
 * saves an edit to the title and silently loses their rounding setting.
 *
 * Two mappings are not symmetrical, both deliberately:
 *
 * - `roundTo: null` is the API's "rounding off", so it becomes
 *   `roundingEnabled: false` **and keeps a sensible default in the field**, so
 *   ticking the box back on offers `0.99` rather than an empty input.
 * - Targets arrive as one flat list and are sorted back into the per-picker
 *   buckets the form works in.
 */
export function fromCampaign(
  campaign: CampaignFormSource,
  targets: readonly CampaignTargetSelection[] = [],
): CampaignFormState {
  const empty = emptyCampaignForm();
  // The campaign's own zone wins over the browser's — that is the whole point
  // of storing it, and reopening a Tokyo campaign in London must still show
  // Tokyo's clock.
  const timezone =
    campaign.startTimezone || campaign.endTimezone || empty.timezone;

  const pick = (
    mode: CampaignTargetMode,
    type: CampaignTargetType,
  ): string[] =>
    targets
      .filter((target) => target.mode === mode && target.targetType === type)
      .map((target) => target.targetValue);

  return {
    ...empty,
    title: campaign.title,
    priceSource: campaign.priceSource,

    // The adjustment is "on" when the API has all three parts of one. A
    // tags-only campaign stores them as null, which is the off switch.
    adjustmentEnabled:
      campaign.adjustmentUnit !== null &&
      campaign.adjustmentDirection !== null &&
      campaign.adjustmentValue !== null,
    adjustmentUnit: campaign.adjustmentUnit ?? empty.adjustmentUnit,
    adjustmentDirection:
      campaign.adjustmentDirection ?? empty.adjustmentDirection,
    // Trailing zeros from the decimal column would show as "20.0000" in the
    // field, which reads like a different number than the one they typed.
    adjustmentValue: trimZeros(campaign.adjustmentValue),

    basis: campaign.basis,

    roundingEnabled: campaign.roundTo !== null,
    roundTo: campaign.roundTo === null ? empty.roundTo : trimZeros(campaign.roundTo),
    roundStrategy: campaign.roundStrategy,
    setCompareAt: campaign.setCompareAt,

    includeMode: campaign.includeMode,
    includeProducts: pick(CampaignTargetMode.INCLUDE, CampaignTargetType.PRODUCT),
    includeCollections: pick(
      CampaignTargetMode.INCLUDE,
      CampaignTargetType.COLLECTION,
    ),
    includeTags: pick(CampaignTargetMode.INCLUDE, CampaignTargetType.TAG),
    includeVendors: pick(CampaignTargetMode.INCLUDE, CampaignTargetType.VENDOR),
    includeProductTypes: pick(
      CampaignTargetMode.INCLUDE,
      CampaignTargetType.PRODUCT_TYPE,
    ),

    excludeDraftArchived: campaign.excludeDraftArchived,
    exclusionsEnabled: campaign.exclusionsEnabled,
    excludeProducts: pick(CampaignTargetMode.EXCLUDE, CampaignTargetType.PRODUCT),
    excludeCollections: pick(
      CampaignTargetMode.EXCLUDE,
      CampaignTargetType.COLLECTION,
    ),
    excludeTags: pick(CampaignTargetMode.EXCLUDE, CampaignTargetType.TAG),
    excludeVendors: pick(CampaignTargetMode.EXCLUDE, CampaignTargetType.VENDOR),
    excludeProductTypes: pick(
      CampaignTargetMode.EXCLUDE,
      CampaignTargetType.PRODUCT_TYPE,
    ),

    addTags: [...campaign.addTags],
    removeTags: [...campaign.removeTags],

    /*
     * A saved campaign always has a start, so the mode is inferred from
     * whether that start is in the future. A campaign due to start next
     * Tuesday reopens on "Schedule for later" with Tuesday in the field;
     * one that already started reopens on "Immediately", because re-saving it
     * should not re-schedule it into the past.
     */
    scheduleMode: isFuture(campaign.startAt) ? 'SCHEDULE' : 'IMMEDIATELY',
    startAt: toLocalInput(campaign.startAt, timezone) || nowInZone(timezone),
    hasEndDate: campaign.endAt !== null,
    endAt: toLocalInput(campaign.endAt, timezone),
    timezone,
  };
}

/** Only what the form needs, so a DTO and an entity both satisfy it. */
export type CampaignFormSource = Pick<
  CampaignDto,
  | 'title'
  | 'priceSource'
  | 'adjustmentUnit'
  | 'adjustmentDirection'
  | 'adjustmentValue'
  | 'basis'
  | 'roundTo'
  | 'roundStrategy'
  | 'setCompareAt'
  | 'includeMode'
  | 'excludeDraftArchived'
  | 'exclusionsEnabled'
  | 'addTags'
  | 'removeTags'
  | 'startAt'
  | 'startTimezone'
  | 'endAt'
  | 'endTimezone'
>;

export type CampaignTargetSelection = Pick<
  CampaignTargetDto,
  'mode' | 'targetType' | 'targetValue'
>;

/** `20.0000` → `20`, `10.5000` → `10.5`. Never touches a non-decimal. */
function trimZeros(value: string | null): string {
  if (!value) return '';
  return value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value;
}

/**
 * An instant back into the `datetime-local` string the input shows.
 *
 * Rendered in the **campaign's** zone, matching how `toInstant` reads it back.
 * The two must agree: rendering in one zone and parsing in another shifts the
 * schedule by the offset between them every time the form is opened and saved,
 * which walks a campaign's start time across the calendar one edit at a time.
 */
function toLocalInput(value: string | Date | null, timeZone: string): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return localFromInstant(date, timeZone);
}

function isFuture(value: string | Date | null): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function targetsFor(
  mode: CampaignTargetMode,
  groups: { type: CampaignTargetType; values: string[] }[],
): CampaignTargetInput[] {
  return groups.flatMap((group) =>
    group.values.map((value) => ({
      mode,
      targetType: group.type,
      targetValue: value,
    })),
  );
}

/** All selected targets, flattened the way the API takes them. */
export function collectTargets(form: CampaignFormState): CampaignTargetInput[] {
  const include =
    form.includeMode === CampaignIncludeMode.SPECIFIC
      ? targetsFor(CampaignTargetMode.INCLUDE, [
          { type: CampaignTargetType.PRODUCT, values: form.includeProducts },
          { type: CampaignTargetType.COLLECTION, values: form.includeCollections },
          { type: CampaignTargetType.TAG, values: form.includeTags },
          { type: CampaignTargetType.VENDOR, values: form.includeVendors },
          { type: CampaignTargetType.PRODUCT_TYPE, values: form.includeProductTypes },
        ])
      : [];

  // Exclusion rows are kept even when the switch is off, so turning it back on
  // restores the merchant's list instead of asking them to rebuild it.
  const exclude = targetsFor(CampaignTargetMode.EXCLUDE, [
    { type: CampaignTargetType.PRODUCT, values: form.excludeProducts },
    { type: CampaignTargetType.COLLECTION, values: form.excludeCollections },
    { type: CampaignTargetType.TAG, values: form.excludeTags },
    { type: CampaignTargetType.VENDOR, values: form.excludeVendors },
    { type: CampaignTargetType.PRODUCT_TYPE, values: form.excludeProductTypes },
  ]);

  return [...include, ...exclude];
}

export function countIncludeTargets(form: CampaignFormState): number {
  return (
    form.includeProducts.length +
    form.includeCollections.length +
    form.includeTags.length +
    form.includeVendors.length +
    form.includeProductTypes.length
  );
}

export function countExcludeTargets(form: CampaignFormState): number {
  return (
    form.excludeProducts.length +
    form.excludeCollections.length +
    form.excludeTags.length +
    form.excludeVendors.length +
    form.excludeProductTypes.length
  );
}

/**
 * A wall-clock time in the campaign's zone, to the instant the API stores.
 *
 * **Not `new Date(value)`.** That reads the string in whatever zone the
 * browser happens to be in, so a merchant in London scheduling a New York
 * campaign for 9am would have stored 09:00 London — four or five hours early
 * depending on the month, and wrong by a different amount either side of a DST
 * boundary. `instantFromLocal` resolves it in the zone the merchant chose.
 */
function toInstant(local: string, timeZone: string): string | null {
  if (!local) return null;
  try {
    return instantFromLocal(local, timeZone).toISOString();
  } catch {
    return null;
  }
}

export function toRequest(form: CampaignFormState): CreateCampaignRequest {
  return {
    title: form.title.trim(),
    priceSource: form.priceSource,
    adjustmentUnit: form.adjustmentEnabled ? form.adjustmentUnit : null,
    adjustmentDirection: form.adjustmentEnabled
      ? form.adjustmentDirection
      : null,
    adjustmentValue: form.adjustmentEnabled
      ? (form.adjustmentValue.trim() as Money)
      : null,
    basis: form.basis,
    // Null is the off switch, not a missing value.
    roundTo: form.roundingEnabled ? (form.roundTo as Money) : null,
    roundStrategy: form.roundStrategy,
    setCompareAt: form.setCompareAt,
    includeMode: form.includeMode,
    excludeDraftArchived: form.excludeDraftArchived,
    exclusionsEnabled: form.exclusionsEnabled,
    targets: collectTargets(form),
    addTags: form.addTags,
    removeTags: form.removeTags,
    /*
     * "Immediately" resolves to now *at save time*, not to whatever was in the
     * field. The field still holds a time — the form shows one — but a merchant
     * who filled in a date, switched to immediate and saved an hour later means
     * now, not the hour-old value sitting in the input.
     */
    startAt:
      form.scheduleMode === 'IMMEDIATELY'
        ? new Date().toISOString()
        : toInstant(form.startAt, form.timezone),
    startTimezone: form.timezone,
    endAt: form.hasEndDate ? toInstant(form.endAt, form.timezone) : null,
    endTimezone: form.timezone,
  };
}

/**
 * Client-side checks that mirror the server's rules.
 *
 * The server is still the authority — this only saves a round trip and puts
 * the message next to the field. Anything not caught here is caught there.
 */
export function validateForm(form: CampaignFormState): string | null {
  if (!form.title.trim()) return 'Give the campaign a name.';

  if (form.adjustmentEnabled) {
    const value = form.adjustmentValue.trim();
    if (!value) return 'Enter how much to change prices by.';
    if (!/^\d{1,15}(\.\d{1,4})?$/.test(value)) {
      return 'The amount must be a number with up to four decimal places.';
    }
    if (Number(value) <= 0) return 'The amount must be greater than zero.';
    if (
      form.adjustmentUnit === CampaignAdjustmentUnit.PERCENTAGE &&
      form.adjustmentDirection === CampaignAdjustmentDirection.DECREASE &&
      Number(value) > 100
    ) {
      return 'A percentage decrease cannot be more than 100%.';
    }
  }

  if (
    form.includeMode === CampaignIncludeMode.SPECIFIC &&
    countIncludeTargets(form) === 0
  ) {
    return 'Choose at least one product, collection, tag, vendor or type to include.';
  }

  return validateSchedule(form);
}

/**
 * The schedule rules, separately so the Schedule card can show them per field.
 *
 * Every comparison is between *instants*, never between the local strings. Two
 * wall-clock times only order correctly once they are resolved in a zone, and
 * comparing the strings is how "10pm to 2am" reads as an eleven-hour mistake.
 */
export function validateSchedule(form: CampaignFormState): string | null {
  if (form.scheduleMode === 'SCHEDULE') {
    if (!form.startAt) return 'Choose when the campaign should start.';

    if (!localTimeExists(form.startAt, form.timezone)) {
      // The spring-forward hour. Saving it would silently start the campaign an
      // hour off, which is the kind of thing nobody notices until the sale is
      // already live.
      return 'That time does not exist on that date — the clocks go forward. Pick another time.';
    }

    const start = safeInstant(form.startAt, form.timezone);
    if (!start) return 'That start date is not a real date and time.';
    if (start.getTime() <= Date.now()) {
      return 'A scheduled start must be in the future. Choose "Activate immediately" to start it now.';
    }
  }

  if (!form.hasEndDate) return null;
  if (!form.endAt) return 'Choose when the campaign should end.';

  if (!localTimeExists(form.endAt, form.timezone)) {
    return 'That end time does not exist on that date — the clocks go forward. Pick another time.';
  }

  const end = safeInstant(form.endAt, form.timezone);
  if (!end) return 'That end date is not a real date and time.';

  // An immediate campaign is measured from now, since that is what its start
  // will be by the time it saves.
  const start =
    form.scheduleMode === 'IMMEDIATELY'
      ? new Date()
      : safeInstant(form.startAt, form.timezone);

  if (start && end.getTime() <= start.getTime()) {
    return 'The end must be after the start.';
  }
  return null;
}

function safeInstant(local: string, timeZone: string): Date | null {
  try {
    return instantFromLocal(local, timeZone);
  } catch {
    return null;
  }
}
