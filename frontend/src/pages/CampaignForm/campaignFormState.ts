import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  CampaignTargetMode,
  CampaignTargetType,
  type CampaignTargetInput,
  type CreateCampaignRequest,
  type Money,
} from '@pricelogic/shared';

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

  startAt: string;
  startTimezone: string;
  endAt: string;
  endTimezone: string;
}

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

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
    startAt: '',
    // The merchant's own zone, not UTC: "9am" means 9am where they are, and
    // the schedule survives a DST boundary because the zone travels with it.
    startTimezone: timezone,
    endAt: '',
    endTimezone: timezone,
  };
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

/** Local datetime from the form to an instant the API accepts. */
function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    startAt: toIso(form.startAt),
    startTimezone: form.startTimezone,
    endAt: toIso(form.endAt),
    endTimezone: form.endTimezone,
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

  if (form.startAt && form.endAt) {
    if (new Date(form.endAt).getTime() <= new Date(form.startAt).getTime()) {
      return 'The end date must be after the start date.';
    }
  }

  return null;
}
