import type { Money } from '../money/money.js';
import type { Serialized } from '../serialization.js';

export enum PriceChangeStatus {
  /** Row written, Shopify not called yet. */
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  FAILED = 'FAILED',
  REVERTED = 'REVERTED',
  /** Nothing to do — the new price equalled the old one, or it was unsafe. */
  SKIPPED = 'SKIPPED',
}

/**
 * What we changed on one variant, and what to put back.
 *
 * Deliberately self-contained: revert reads a single row and writes
 * `oldPrice` and `oldCompareAtPrice` back to Shopify. No join, no snapshot.
 * Rows are never deleted, so this is also the price history.
 *
 * The Shopify ids are plain strings with no foreign key — the catalog is
 * never mirrored into this database, so there is nothing to point at.
 */
export interface PriceChange {
  id: string;
  shopId: string;
  /** Never null — every price change belongs to exactly one campaign. */
  campaignId: string;
  /**
   * The execution that produced this row. Uniqueness is on
   * `(jobId, shopifyVariantId)`, not `(campaignId, …)`, so a campaign that
   * runs, reverts and runs again writes a fresh row each time instead of
   * overwriting the price it would need to restore.
   */
  jobId: string;

  shopifyProductId: string;
  shopifyVariantId: string;
  /** Cached at write time so the results screen renders without a Shopify call. */
  productTitle: string;
  variantTitle: string | null;

  oldPrice: Money;
  oldCompareAtPrice: Money | null;
  newPrice: Money;
  newCompareAtPrice: Money | null;
  currency: string;

  status: PriceChangeStatus;
  errorMessage: string | null;
  appliedAt: Date | null;
  revertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PriceChangeDto = Serialized<PriceChange>;
