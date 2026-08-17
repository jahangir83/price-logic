import type { MatchStrategy } from '../dto/import.dto.js';
import type { Money } from '../money/money.js';
import type { Serialized } from '../serialization.js';

export enum CsvRowStatus {
  /** Parsed cleanly, not yet matched. */
  VALID = 'VALID',
  /** Unparseable or nonsensical — see `errorMessage`. */
  INVALID = 'INVALID',
  /** SKU resolved to exactly one Shopify variant. */
  MATCHED = 'MATCHED',
  /** SKU resolved to zero variants, or ambiguously to several. */
  UNMATCHED = 'UNMATCHED',
}

/**
 * One row of an uploaded sheet, and the three numbers the approval form shows
 * side by side:
 *
 * - `currentPrice` — what the merchant charges now, fetched from Shopify
 * - `sheetPrice` — what the supplier sent
 * - `approvedPrice` — what it becomes, pre-filled by the calculation pipeline
 *   and editable by the merchant
 *
 * `sheetPrice` is the *base*, not the final answer: the campaign's adjustment
 * and rounding still apply on top of it. Any merchant override of
 * `approvedPrice` is revalidated server-side, since a client-supplied price is
 * never trusted for execution.
 */
export interface CsvRow {
  id: string;
  shopId: string;
  csvImportId: string;
  rowNumber: number;
  /** The row exactly as uploaded, kept for debugging and merchant support. */
  rawData: Record<string, unknown>;
  sku: string | null;

  sheetPrice: Money | null;
  sheetCompareAtPrice: Money | null;
  currentPrice: Money | null;
  approvedPrice: Money | null;
  currency: string;

  shopifyProductId: string | null;
  shopifyVariantId: string | null;

  /**
   * What the matched product is called, copied from Shopify when the row was
   * matched.
   *
   * Copied rather than looked up for display, for the same reason
   * `price_changes` caches them: a sheet reviewed today may be approved next
   * week, and a product renamed in between must not turn the review into a
   * list of codes. This is a record of what was compared, not a live view.
   */
  productTitle: string | null;
  variantTitle: string | null;

  /**
   * How many the supplier says they have, when their sheet has a stock column.
   * Null means the sheet did not say — which is not the same as zero.
   */
  sheetStock: number | null;

  /** The supplier's own code, when their sheet carries one. */
  supplierSku: string | null;
  /** UPC / EAN / GTIN from the sheet, when it carries one. */
  barcode: string | null;
  /**
   * Which identifier found the variant, or null when nothing did.
   *
   * Kept so a confident SKU match is distinguishable from a barcode fallback —
   * they are not equally trustworthy and the merchant should be able to see
   * which is which.
   */
  matchedBy: MatchStrategy | null;

  /**
   * How many the shop has, read from Shopify when the row was matched.
   *
   * Shown, but deliberately **not** what the skip decision is made on at
   * activation: this is from whenever the sheet was matched, possibly days
   * before approval, and stock moves. Activation re-reads it live.
   */
  stockQuantity: number | null;

  /** Merchant can drop a row from the campaign without deleting the record. */
  excluded: boolean;
  status: CsvRowStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CsvRowDto = Serialized<CsvRow>;

/** A row is eligible for the campaign only if it matched and was not dropped. */
export function isCsvRowApplicable(
  row: Pick<CsvRow, 'status' | 'excluded' | 'shopifyVariantId'>,
): boolean {
  return (
    !row.excluded &&
    row.status === CsvRowStatus.MATCHED &&
    row.shopifyVariantId !== null
  );
}
