import {
  CSV_COLUMN_ALIASES,
  REQUIRED_CSV_COLUMNS,
  isMoney,
  type CsvColumn,
  type Money,
} from '@pricelogic/shared';

/**
 * Reading a supplier's spreadsheet export.
 *
 * Written by hand rather than pulled from a library because the failure mode
 * that matters is not "malformed CSV" — it is a merchant who exported the
 * wrong sheet and needs to be told *which line* is wrong and why. Every row
 * carries its own verdict, and one bad line never fails the file.
 *
 * Pure: takes text, returns rows. No database, no file system.
 */

export interface ParsedSheetRow {
  /** 1-based, counting the header as row 1, so it matches the merchant's view. */
  rowNumber: number;
  /** The row exactly as it arrived, for support questions later. */
  raw: Record<string, string>;
  sku: string | null;
  price: Money | null;
  compareAtPrice: Money | null;
  /**
   * How many the supplier says they have. Null means the sheet did not say,
   * which is not the same as zero — most sheets have no stock column at all.
   */
  stock: number | null;
  /** The supplier's own code, when the sheet carries one. */
  supplierSku: string | null;
  /** UPC / EAN / GTIN, when the sheet carries one. */
  barcode: string | null;
  /** Set when the row cannot be used; null when it is fine. */
  error: string | null;
}

export interface ParsedSheet {
  headers: string[];
  /** Which incoming header was used for each column we care about. */
  columnMap: Partial<Record<CsvColumn, string>>;
  rows: ParsedSheetRow[];
  /**
   * Set only when the file itself is unusable — no header, or no SKU/price
   * column. A row-level problem never lands here.
   */
  fatalError: string | null;
}

/**
 * Split CSV text into rows of fields.
 *
 * Handles the four things real supplier exports actually contain: a UTF-8 BOM
 * from Excel, CRLF line endings from Windows, quoted fields holding commas or
 * newlines, and `""` as an escaped quote. A trailing empty line is dropped
 * rather than becoming a phantom row.
 */
export function tokenizeCsv(input: string): string[][] {
  // Excel writes a BOM; left in place it becomes part of the first header and
  // "SKU" stops matching.
  const text = input.replace(/^\uFEFF/, '');

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // CRLF: the \n on the next iteration ends the row.
    } else {
      field += char;
    }
  }

  // Whatever is left after the last newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => !isBlankRow(cells));
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/** Headers differ by supplier: "Compare At Price", "compare_at_price", "MSRP". */
function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]/g, '');
}

function mapColumns(headers: string[]): Partial<Record<CsvColumn, string>> {
  const map: Partial<Record<CsvColumn, string>> = {};

  for (const [column, aliases] of Object.entries(CSV_COLUMN_ALIASES) as [
    CsvColumn,
    readonly string[],
  ][]) {
    const match = headers.find((header) =>
      aliases.includes(normaliseHeader(header)),
    );
    if (match !== undefined) {
      map[column] = match;
    }
  }

  return map;
}

export function parseSheet(content: string): ParsedSheet {
  const table = tokenizeCsv(content);

  if (table.length === 0) {
    return {
      headers: [],
      columnMap: {},
      rows: [],
      fatalError: 'The file is empty.',
    };
  }

  const headers = (table[0] ?? []).map((header) => header.trim());
  const columnMap = mapColumns(headers);

  const missing = REQUIRED_CSV_COLUMNS.filter((column) => !columnMap[column]);
  if (missing.length > 0) {
    // A file with no SKU column is not a supplier sheet at all, so this is the
    // one case where rejecting the whole upload is more useful than 5,000
    // identical row errors.
    return {
      headers,
      columnMap,
      rows: [],
      fatalError: `The file needs a column for ${missing.join(' and ')}. Found: ${headers.join(', ') || 'no headers'}.`,
    };
  }

  const rows = table.slice(1).map((cells, index) => {
    const raw = toRecord(headers, cells);
    return validateRow(raw, columnMap, index + 2);
  });

  return {
    headers,
    columnMap,
    rows: flagDuplicateSkus(rows),
    fatalError: null,
  };
}

function toRecord(headers: string[], cells: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = (cells[index] ?? '').trim();
  });
  return record;
}

function validateRow(
  raw: Record<string, string>,
  columnMap: Partial<Record<CsvColumn, string>>,
  rowNumber: number,
): ParsedSheetRow {
  const sku = valueOf(raw, columnMap.sku);
  const rawPrice = valueOf(raw, columnMap.price);
  const rawCompareAt = valueOf(raw, columnMap.compareAtPrice);
  const stock = parseStock(valueOf(raw, columnMap.stock));
  const supplierSku = valueOf(raw, columnMap.supplierSku);
  const barcode = valueOf(raw, columnMap.barcode);

  const base: ParsedSheetRow = {
    rowNumber,
    raw,
    sku,
    price: null,
    compareAtPrice: null,
    stock,
    supplierSku,
    barcode,
    error: null,
  };

  if (!sku) {
    return { ...base, error: 'This row has no SKU.' };
  }
  if (!rawPrice) {
    return { ...base, error: 'This row has no price.' };
  }

  const price = normalisePrice(rawPrice);
  if (price === null) {
    return {
      ...base,
      error: `“${rawPrice}” is not a price we can read.`,
    };
  }
  if (price.startsWith('-')) {
    return { ...base, error: 'The price is negative.' };
  }
  if (Number(price) === 0) {
    // Zero is almost always a blank cell that picked up a format, not a
    // supplier giving stock away.
    return { ...base, error: 'The price is zero.' };
  }

  const compareAt = rawCompareAt ? normalisePrice(rawCompareAt) : null;
  if (rawCompareAt && compareAt === null) {
    return {
      ...base,
      price,
      error: `“${rawCompareAt}” is not a compare-at price we can read.`,
    };
  }

  return { ...base, price, compareAtPrice: compareAt };
}

/**
 * A stock count, or null when the sheet did not give a usable one.
 *
 * Deliberately forgiving and deliberately never an error. Stock is an optional
 * extra: a supplier who writes "in stock", "yes" or "—" has still sent a
 * perfectly good price, and failing the row over a column that did not have to
 * be there at all would be the parser inventing a problem.
 *
 * Words that plainly mean none are honoured, because "out of stock" as text is
 * common enough that treating it as unknown would reprice exactly the rows this
 * feature exists to leave alone.
 */
const NO_STOCK_WORDS = new Set([
  'out of stock',
  'outofstock',
  'sold out',
  'soldout',
  'unavailable',
  'no',
  'none',
]);

export function parseStock(input: string | null): number | null {
  if (input === null) return null;

  const text = input.trim().toLowerCase();
  if (text === '') return null;
  if (NO_STOCK_WORDS.has(text)) return 0;

  // Thousands separators and a stray unit suffix are common in exports.
  const cleaned = text.replace(/,/g, '').replace(/\s/g, '');
  const match = /^-?\d+/.exec(cleaned);
  if (!match) return null;

  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function valueOf(
  raw: Record<string, string>,
  header: string | undefined,
): string | null {
  if (!header) return null;
  const value = raw[header]?.trim();
  return value ? value : null;
}

/**
 * Strip the decoration spreadsheets add — a currency symbol, thousands
 * separators, a trailing space — and reject anything still not exact decimal
 * money.
 *
 * Deliberately does **not** try to interpret `1.234,56`: European and US
 * conventions are ambiguous at a glance, and guessing wrong reprices a
 * catalogue by a factor of a hundred.
 */
export function normalisePrice(input: string): Money | null {
  const cleaned = input
    .trim()
    .replace(/^[^\d\-.]+/, '')
    .replace(/,/g, '')
    .replace(/\s/g, '');

  if (cleaned === '') return null;
  if (!isMoney(cleaned)) return null;
  return cleaned;
}

/**
 * Two rows for one SKU: flag **both**, do not let the last one win.
 *
 * A supplier sheet with duplicates usually means the merchant exported the
 * wrong thing — two price lists concatenated, or a per-warehouse breakdown.
 * Silently taking one price would apply a real, wrong number to a live
 * storefront, and the merchant would have no way to notice.
 */
function flagDuplicateSkus(rows: ParsedSheetRow[]): ParsedSheetRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.error || !row.sku) continue;
    const key = row.sku.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return rows.map((row) => {
    if (row.error || !row.sku) return row;
    const seen = counts.get(row.sku.toLowerCase()) ?? 0;
    if (seen <= 1) return row;
    return {
      ...row,
      error: `This SKU appears ${seen} times in the file, so it is not clear which price to use.`,
    };
  });
}
