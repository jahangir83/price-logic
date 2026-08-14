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
