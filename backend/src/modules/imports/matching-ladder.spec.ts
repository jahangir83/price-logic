import { CsvRowStatus, MatchStrategy } from '@pricelogic/shared';
import type { Repository } from 'typeorm';
import type { Campaign } from '../campaigns/entities/campaign.entity';
import type { Shop } from '../shops/entities/shop.entity';
import type {
  ShopifyAdminService,
  VariantPriceRecord,
} from '../shopify/services/shopify-admin.service';
import { CsvImport } from './entities/csv-import.entity';
import { CsvRow } from './entities/csv-row.entity';
import { ImportsService } from './services/imports.service';

/**
 * The ladder, not the lookups.
 *
 * These assert on which rung answered and which rows each rung was asked
 * about — the ordering and short-circuiting are the whole feature, and neither
 * is visible from the outcome of a single row.
 */
function variant(
  id: string,
  over: Partial<VariantPriceRecord> = {},
): VariantPriceRecord {
  return {
    variantId: `gid://v/${id}`,
    productId: `gid://p/${id}`,
    productTitle: `Product ${id}`,
    variantTitle: 'Default',
    sku: `SKU-${id}`,
    barcode: null,
    price: '10.0000',
    compareAtPrice: null,
    inventoryQuantity: 5,
    ...over,
  };
}

function row(over: Partial<CsvRow>): CsvRow {
  return {
    id: over.sku ?? 'row-1',
    status: CsvRowStatus.VALID,
    sku: null,
    supplierSku: null,
    barcode: null,
    sheetPrice: '9.0000',
    ...over,
  } as CsvRow;
}

describe('the matching ladder', () => {
  let rows: CsvRow[];
  let skuCalls: string[][];
  let barcodeCalls: string[][];
  let service: ImportsService;

  function build(
    given: CsvRow[],
    answers: {
      sku?: Record<string, VariantPriceRecord[]>;
      barcode?: Record<string, VariantPriceRecord[]>;
    },
  ) {
    rows = given;
    skuCalls = [];
    barcodeCalls = [];

    const shopify = {
      findVariantsBySku: (_shop: Shop, values: string[]) => {
        skuCalls.push([...values]);
        return Promise.resolve(
          values.map((v) => ({ sku: v, variants: answers.sku?.[v] ?? [] })),
        );
      },
      findVariantsByBarcode: (_shop: Shop, values: string[]) => {
        barcodeCalls.push([...values]);
        return Promise.resolve(
          values.map((v) => ({ sku: v, variants: answers.barcode?.[v] ?? [] })),
        );
      },
    } as unknown as ShopifyAdminService;

    service = new ImportsService(
      {
        findOne: jest.fn().mockResolvedValue({ id: 'imp-1' }),
        update: jest.fn(),
      } as unknown as Repository<CsvImport>,
      {
        find: jest.fn().mockResolvedValue(given),
        save: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      } as unknown as Repository<CsvRow>,
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<Campaign>,
      shopify,
      {} as never,
      // `recount` finishes the match with one aggregate query; these tests are
      // about which rung answered, so it only has to not throw.
      {
        query: () =>
          Promise.resolve([{ total: '0', invalid: '0', matched: '0' }]),
      } as never,
      { get: () => undefined } as never,
    );
  }

  const shop = { id: 'shop-1', currency: 'GBP', defaultSettings: {} } as Shop;

  it('matches on the merchant SKU first', async () => {
    build([row({ id: 'r1', sku: 'SKU-1', barcode: 'BAR-1' })], {
      sku: { 'SKU-1': [variant('1')] },
      barcode: { 'BAR-1': [variant('2')] },
    });

    await service.match(shop, 'imp-1');

    expect(rows[0].matchedBy).toBe(MatchStrategy.SKU);
    expect(rows[0].shopifyVariantId).toBe('gid://v/1');
  });

  it('does not ask a later rung about a row already matched', async () => {
    // The cost argument for the whole design: a sheet that matches on SKU must
    // cost exactly what it cost before the ladder existed.
    build([row({ id: 'r1', sku: 'SKU-1', barcode: 'BAR-1' })], {
      sku: { 'SKU-1': [variant('1')] },
    });

    await service.match(shop, 'imp-1');

    expect(barcodeCalls).toEqual([]);
  });

  it('falls through to the supplier SKU when the merchant SKU finds nothing', async () => {
    build([row({ id: 'r1', sku: 'MISSING', supplierSku: 'SUP-9' })], {
      sku: { 'SUP-9': [variant('9')] },
    });

    await service.match(shop, 'imp-1');

    expect(rows[0].matchedBy).toBe(MatchStrategy.SUPPLIER_SKU);
    expect(rows[0].status).toBe(CsvRowStatus.MATCHED);
  });

  it('falls through to the barcode last', async () => {
    build([row({ id: 'r1', sku: 'MISSING', barcode: 'BAR-7' })], {
      barcode: { 'BAR-7': [variant('7', { barcode: 'BAR-7' })] },
    });

    await service.match(shop, 'imp-1');

    expect(rows[0].matchedBy).toBe(MatchStrategy.BARCODE);
    expect(rows[0].shopifyVariantId).toBe('gid://v/7');
  });

  it('asks each rung only about the rows still unresolved', async () => {
    build(
      [
        row({ id: 'r1', sku: 'SKU-1', barcode: 'BAR-1' }),
        row({ id: 'r2', sku: 'MISSING', barcode: 'BAR-2' }),
      ],
      {
        sku: { 'SKU-1': [variant('1')] },
        barcode: { 'BAR-2': [variant('2', { barcode: 'BAR-2' })] },
      },
    );

    await service.match(shop, 'imp-1');

    expect(skuCalls[0]).toEqual(['SKU-1', 'MISSING']);
    expect(barcodeCalls[0]).toEqual(['BAR-2']);
  });

  it('never guesses when a rung finds more than one', async () => {
    build([row({ id: 'r1', sku: 'DUPE' })], {
      sku: { DUPE: [variant('1'), variant('2')] },
    });

    await service.match(shop, 'imp-1');

    expect(rows[0].status).toBe(CsvRowStatus.UNMATCHED);
    expect(rows[0].shopifyVariantId).toBeNull();
    expect(rows[0].errorMessage).toContain('2 products share');
  });

  it('lets a clean barcode rescue an ambiguous SKU', async () => {
    // Two products sharing a SKU is a merchant data problem. If the barcode
    // answers unambiguously, that is a better outcome than telling them to go
    // and fix their SKUs.
    build([row({ id: 'r1', sku: 'DUPE', barcode: 'BAR-3' })], {
      sku: { DUPE: [variant('1'), variant('2')] },
      barcode: { 'BAR-3': [variant('3', { barcode: 'BAR-3' })] },
    });

    await service.match(shop, 'imp-1');

    expect(rows[0].status).toBe(CsvRowStatus.MATCHED);
    expect(rows[0].matchedBy).toBe(MatchStrategy.BARCODE);
  });

  it('reports ambiguity when no later rung resolves it', async () => {
    build([row({ id: 'r1', sku: 'DUPE', barcode: 'NOPE' })], {
      sku: { DUPE: [variant('1'), variant('2')] },
    });

    await service.match(shop, 'imp-1');

    expect(rows[0].errorMessage).toContain('share that identifier');
  });

  it('leaves a sheet with only SKUs behaving exactly as before', async () => {
    build([row({ id: 'r1', sku: 'MISSING' })], {});

    await service.match(shop, 'imp-1');

    expect(rows[0].status).toBe(CsvRowStatus.UNMATCHED);
    expect(rows[0].matchedBy).toBeNull();
    // No identifier to try, so no wasted round trip.
    expect(barcodeCalls).toEqual([]);
  });
});
