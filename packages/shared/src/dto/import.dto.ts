import type { CsvImportDto } from '../domain/csv-import.js';
import type { CsvRowDto, CsvRowStatus } from '../domain/csv-row.js';
import type { Money } from '../money/money.js';
import type { CreateCampaignRequest } from './campaign.dto.js';

/**
 * The columns a supplier sheet must provide, and the aliases we accept for
 * each. Matching is case-insensitive and ignores spaces and underscores, so a
 * supplier's "Compare At Price" and "compare_at_price" both land.
 *
 * Shared because the upload screen shows the merchant which headers are
 * expected, and it must not drift from what the parser accepts.
 */
export const CSV_COLUMN_ALIASES = {
  sku: ['sku', 'variantsku', 'itemnumber', 'itemcode'],
  price: ['price', 'newprice', 'unitprice', 'sellingprice'],
  compareAtPrice: ['compareatprice', 'msrp', 'rrp', 'listprice'],
} as const satisfies Record<string, readonly string[]>;

export type CsvColumn = keyof typeof CSV_COLUMN_ALIASES;

/** Only `sku` and `price` are required; a sheet without both is rejected. */
export const REQUIRED_CSV_COLUMNS: readonly CsvColumn[] = ['sku', 'price'];

export interface CreateCsvImportRequest {
  supplierId: string;
  fileName: string;
}

export interface ListCsvRowsQuery {
  status?: CsvRowStatus;
  /** Show only rows the merchant still needs to look at. */
  problemsOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/** The approval screen: the import, its rows, and the totals above the table. */
export interface CsvImportReviewResponse {
  import: CsvImportDto;
  supplierName: string;
  rows: CsvRowDto[];
  totalItems: number;
  page: number;
  pageSize: number;
}

/** A merchant editing one line of the approval form. */
export interface CsvRowOverrideRequest {
  rowId: string;
  approvedPrice?: Money;
  excluded?: boolean;
}

/**
 * Approving an import creates a campaign in the background.
 *
 * `campaign` carries the merchant's own markup on top of the sheet — the
 * supplier sets the base price, the merchant sets the adjustment. Leaving it
 * out applies the sheet's prices as-is. `priceSource` and `csvImportId` are
 * set by the server and ignored if sent.
 */
export interface ApproveCsvImportRequest {
  overrides?: CsvRowOverrideRequest[];
  campaign?: Omit<CreateCampaignRequest, 'priceSource' | 'csvImportId'>;
  /** Activate immediately instead of leaving the campaign in DRAFT. */
  activateNow?: boolean;
}

export interface ApproveCsvImportResponse {
  importId: string;
  campaignId: string;
  applicableRows: number;
}
