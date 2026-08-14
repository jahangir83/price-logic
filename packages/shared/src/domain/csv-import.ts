import type { Serialized } from '../serialization.js';

export enum CsvImportStatus {
  UPLOADED = 'UPLOADED',
  PARSING = 'PARSING',
  /** Parsed and matched; waiting for the merchant to review and approve. */
  READY = 'READY',
  /** Merchant approved — a campaign has been (or is being) created from it. */
  APPROVED = 'APPROVED',
  FAILED = 'FAILED',
}

/**
 * One uploaded supplier sheet.
 *
 * Staging, not a durable parent: approving an import creates a campaign, and
 * from that point the campaign owns the outcome. `price_changes` never points
 * here — it always points at a campaign.
 *
 * The sheet carries **final prices**, not costs. The campaign's own
 * adjustment, if any, applies on top of `CsvRow.sheetPrice`.
 */
export interface CsvImport {
  id: string;
  shopId: string;
  supplierId: string;
  fileName: string;
  status: CsvImportStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Rows whose SKU resolved to exactly one Shopify variant. */
  matchedRows: number;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type CsvImportDto = Serialized<CsvImport>;
