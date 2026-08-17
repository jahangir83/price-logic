import type {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  CampaignStatus,
  DuplicatePolicy,
} from '../domain/campaign.js';
import type { PriceEndingStrategy } from '../money/rounding.js';
import type {
  CampaignTargetMode,
  CampaignTargetType,
} from '../domain/campaign-target.js';
import type { PriceChangeDto } from '../domain/price-change.js';
import type { Money } from '../money/money.js';
import type { Iso8601 } from '../serialization.js';

export interface CampaignTargetInput {
  mode: CampaignTargetMode;
  targetType: CampaignTargetType;
  targetValue: string;
}

export interface CreateCampaignRequest {
  title: string;

  priceSource?: CampaignPriceSource;
  /** Required when `priceSource` is SHEET. */
  csvImportId?: string | null;

  /** All three or none — a half-specified adjustment is rejected. */
  adjustmentUnit?: CampaignAdjustmentUnit | null;
  adjustmentDirection?: CampaignAdjustmentDirection | null;
  adjustmentValue?: Money | null;

  basis?: CampaignBasis;
  /** Null turns rounding off; it is the switch, not a missing value. */
  roundTo?: Money | null;
  roundStrategy?: PriceEndingStrategy;
  setCompareAt?: boolean;
  /** Null means "use the shop's global setting". */
  duplicatePolicy?: DuplicatePolicy | null;

  includeMode?: CampaignIncludeMode;
  excludeDraftArchived?: boolean;
  exclusionsEnabled?: boolean;
  targets?: CampaignTargetInput[];

  addTags?: string[];
  removeTags?: string[];

  startAt?: Iso8601 | null;
  startTimezone?: string;
  endAt?: Iso8601 | null;
  endTimezone?: string;
}

/** Same fields, all optional. Only a DRAFT campaign may be edited. */
export type UpdateCampaignRequest = Partial<CreateCampaignRequest>;

export interface ListCampaignsQuery {
  status?: CampaignStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * One line of the preview table, and of the results table after activation.
 *
 * Produced server-side by running the shared calculator over the resolved
 * target set. `changed: false` rows are shown greyed rather than hidden, so
 * the merchant can see why a product they expected was left alone.
 */
export interface CampaignPreviewRow {
  shopifyProductId: string;
  shopifyVariantId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  currentPrice: Money;
  currentCompareAtPrice: Money | null;
  newPrice: Money;
  newCompareAtPrice: Money | null;
  currency: string;
  changed: boolean;
  /** Populated when the row was skipped — e.g. `FLOORED`, `UNCHANGED`. */
  note: string | null;
}

export interface CampaignPreviewResponse {
  campaignId: string;
  /** Variants matched by the targeting rules, before change filtering. */
  totalVariants: number;
  changedVariants: number;
  /** Products whose tag set the campaign would alter. */
  taggedProducts: number;
  rows: CampaignPreviewRow[];
  /** True when `rows` is a capped sample rather than the whole set. */
  truncated: boolean;
}

export interface CampaignResultsResponse {
  campaignId: string;
  applied: number;
  failed: number;
  skipped: number;
  reverted: number;
  /** One page of rows, failures first. */
  changes: PriceChangeDto[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Live counters while a campaign runs.
 *
 * `total` is what the run is working through, so `processed / total` is a real
 * progress bar rather than a spinner. `running` tells the UI whether to keep
 * polling.
 */
export interface CampaignProgressResponse {
  campaignId: string;
  status: CampaignStatus;
  running: boolean;
  total: number;
  applied: number;
  failed: number;
  skipped: number;
  reverted: number;
  pending: number;
}

/** Activation and deactivation are async; the UI polls the campaign after. */
export interface CampaignActionResponse {
  campaignId: string;
  status: CampaignStatus;
  message: string;
}
