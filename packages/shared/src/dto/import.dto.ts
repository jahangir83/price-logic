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
  stock: ['stock', 'quantity', 'qty', 'available', 'inventory', 'stocklevel'],
  supplierSku: ['suppliersku', 'vendorsku', 'suppliercode', 'vendorcode', 'suppliteritem'],
  barcode: ['barcode', 'upc', 'ean', 'gtin', 'isbn'],
} as const satisfies Record<string, readonly string[]>;

export type CsvColumn = keyof typeof CSV_COLUMN_ALIASES;

/** Only `sku` and `price` are required; a sheet without both is rejected. */
export const REQUIRED_CSV_COLUMNS: readonly CsvColumn[] = ['sku', 'price'];

/**
 * Which identifier actually found the variant.
 *
 * Recorded per row because the rungs are not equally trustworthy, and a
 * merchant reviewing four hundred rows deserves to know which ones were found
 * by something other than the SKU they maintain themselves. Those are the ones
 * worth a second look.
 */
export enum MatchStrategy {
  /** The merchant's own SKU column. */
  SKU = 'SKU',
  /** The supplier's code, tried against the store's SKU field. */
  SUPPLIER_SKU = 'SUPPLIER_SKU',
  /** UPC / EAN / GTIN. */
  BARCODE = 'BARCODE',
}

/**
 * The ladder, in the order it is tried.
 *
 * Order is confidence, not convenience. The merchant's own SKU wins because it
 * is the field they maintain. Barcode is the most reliable identifier in the
 * abstract but sits last: a merchant who has given two variants the same
 * barcode — common enough — should not have that outrank the SKU they set.
 */
export const MATCH_LADDER: readonly MatchStrategy[] = [
  MatchStrategy.SKU,
  MatchStrategy.SUPPLIER_SKU,
  MatchStrategy.BARCODE,
];

/** What each column means, for the merchant rather than for the parser. */
export const CSV_COLUMN_HELP: Record<CsvColumn, string> = {
  sku: 'The SKU as it appears on the product in your Shopify store. This is what the row is matched on.',
  price: 'The price you want the product to sell for. Not a cost — your campaign’s adjustment applies on top of this.',
  compareAtPrice:
    'Optional. Shown struck through next to the price, as the supplier’s list or recommended price.',
  stock:
    'Optional. How many the supplier has. A row at zero is left alone rather than repriced — there is no point promoting something you cannot get.',
  supplierSku:
    'Optional. The supplier’s own code. Tried when the SKU column finds nothing, since some stores use the supplier’s code as their SKU.',
  barcode:
    'Optional. UPC, EAN or GTIN. Tried last, and often the one that rescues a row — a barcode survives both sides renaming their codes.',
};

/**
 * A worked example of a supplier sheet.
 *
 * Generated from `CSV_COLUMN_ALIASES` rather than written out, because a
 * hand-written sample is a second source of truth about the file format: add an
 * alias, and the example starts quietly lying about what the parser accepts.
 * The first alias of each column is the canonical spelling.
 *
 * The rows are deliberately unremarkable, and the blanks are the teaching: one
 * row has no compare-at and no stock, which shows both are optional without
 * having to say so twice. The zero-stock row shows what a zero looks like,
 * since that is the value that changes what happens.
 */
export function buildExampleSheet(): string {
  const headers = (Object.keys(CSV_COLUMN_ALIASES) as CsvColumn[]).map(
    (column) => CSV_COLUMN_ALIASES[column][0],
  );

  const rows = [
    ['ACME-TSHIRT-BLK-M', '24.99', '34.99', '120', 'SUP-1001', '5012345678900'],
    ['ACME-TSHIRT-BLK-L', '24.99', '34.99', '0', 'SUP-1002', '5012345678917'],
    ['ACME-MUG-01', '8.50', '', '', '', ''],
  ];

  return [headers, ...rows].map((row) => row.join(',')).join('\n') + '\n';
}

export interface CreateCsvImportRequest {
  supplierId: string;
  fileName: string;
}

/**
 * How the review is ordered.
 *
 * `SHEET` is the merchant's own file order, which is what they see if they open
 * the spreadsheet beside the screen. `CHANGE` is the review order: a sheet
 * where nine hundred prices held steady and four jumped 30% should not bury the
 * four on page thirty.
 */
export enum CsvRowSort {
  SHEET = 'SHEET',
  CHANGE = 'CHANGE',
}

export interface ListCsvRowsQuery {
  sort?: CsvRowSort;
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
