import type { SetupStep, StoreSettings } from '../domain/store-settings.js';

/**
 * The setup guide, as the home screen renders it.
 *
 * Completion is computed per request rather than stored per step. Two of the
 * three steps are recorded visits, but the third — having a campaign — is a
 * fact about the campaigns table, and the server is the only side that can
 * answer it without the browser counting rows it has not fetched.
 */
export interface SetupStepDto {
  step: SetupStep;
  completed: boolean;
  /** When it was completed, where that is known. Null for a derived step. */
  completedAt: string | null;
}

export interface SetupGuideDto {
  steps: SetupStepDto[];
  completedCount: number;
  totalCount: number;
  /**
   * Whether the merchant has hidden the guide. The server still sends the
   * steps: dismissing is a decision about the card, not a reason to stop
   * knowing what is done.
   */
  dismissed: boolean;
}

/** `GET /settings`. Always complete — missing keys are filled on read. */
export interface StoreSettingsResponse {
  settings: StoreSettings;
}

/**
 * `PATCH /settings`. Every field optional: the screen saves what changed.
 *
 * `maximumPrice` accepts null explicitly — "no ceiling" is a choice a merchant
 * can make, and it has to be distinguishable from "not editing this field".
 */
export interface UpdateStoreSettingsRequest {
  defaultPricingStrategy?: StoreSettings['defaultPricingStrategy'];
  minimumMarginPercent?: number;
  minimumPrice?: string;
  maximumPrice?: string | null;
  skipOutOfStock?: boolean;
}
