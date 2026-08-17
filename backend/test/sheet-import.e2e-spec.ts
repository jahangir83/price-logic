import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsvImportStatus, CsvRowStatus, JobType } from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { Campaign } from '../src/modules/campaigns/entities/campaign.entity';
import { CampaignTarget } from '../src/modules/campaigns/entities/campaign-target.entity';
import { PriceChange } from '../src/modules/campaigns/entities/price-change.entity';
import { ProductTagChange } from '../src/modules/campaigns/entities/product-tag-change.entity';
import { CsvImport } from '../src/modules/imports/entities/csv-import.entity';
import { CsvRow } from '../src/modules/imports/entities/csv-row.entity';
import { ImportsService } from '../src/modules/imports/services/imports.service';
import { JobDependency } from '../src/modules/jobs/entities/job-dependency.entity';
import { JobExecution } from '../src/modules/jobs/entities/job-execution.entity';
import { Job } from '../src/modules/jobs/entities/job.entity';
import { JobStepResult } from '../src/modules/jobs/entities/job-step-result.entity';
import { JobsService } from '../src/modules/jobs/services/jobs.service';
import { ShopifyAdminService } from '../src/modules/shopify/services/shopify-admin.service';
import { Shop } from '../src/modules/shops/entities/shop.entity';
import { Supplier } from '../src/modules/suppliers/entities/supplier.entity';

/**
 * The whole import path, end to end, against real PostgreSQL.
 *
 * The fixture deliberately contains one of everything that goes wrong with a
 * supplier sheet: a clean row, an unparseable price, a missing SKU, a
 * duplicated SKU and a SKU that matches nothing in the store. The assertion
 * that matters is not that it succeeds — it is that each bad row lands in the
 * right status with a message a merchant can act on, and that the counters on
 * the import add up.
 */
describe('supplier sheet import', () => {
  let moduleRef: TestingModule;
  let imports: ImportsService;
  let dataSource: DataSource;
  let uploadDir: string;

  const SHOP = '66666666-0000-4000-8000-000000000066';
  const SUPPLIER = '77777777-0000-4000-8000-000000000077';

  /** The store contains GOOD-1 and GOOD-2, plus TWINS twice. */
  const shopifyStub = {
    findVariantsBySku: (_shop: Shop, skus: readonly string[]) =>
      Promise.resolve(
        skus.map((sku) => {
          if (sku === 'GOOD-1' || sku === 'GOOD-2') {
            return {
              sku,
              variants: [
                {
                  variantId: `gid://v/${sku}`,
                  productId: `gid://p/${sku}`,
                  productTitle: sku,
                  variantTitle: 'Default',
                  sku,
                  price: '25.0000',
                  compareAtPrice: null,
                },
              ],
            };
          }
          if (sku === 'TWINS') {
            // Two products sharing a SKU — flagged, never guessed.
            return {
              sku,
              variants: [
                {
                  variantId: 'gid://v/twin-a',
                  productId: 'gid://p/twin-a',
                  productTitle: 'Twin A',
                  variantTitle: 'Default',
                  sku,
                  price: '10.0000',
                  compareAtPrice: null,
                },
                {
                  variantId: 'gid://v/twin-b',
                  productId: 'gid://p/twin-b',
                  productTitle: 'Twin B',
                  variantTitle: 'Default',
                  sku,
                  price: '11.0000',
                  compareAtPrice: null,
                },
              ],
            };
          }
          return { sku, variants: [] };
        }),
      ),
  };

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'pricelogic-uploads-'));

    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [
            Shop,
            Supplier,
            CsvImport,
            CsvRow,
            Campaign,
            CampaignTarget,
            PriceChange,
            ProductTagChange,
            Job,
            JobExecution,
            JobDependency,
            JobStepResult,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          CsvImport,
          CsvRow,
          Campaign,
          Job,
          JobExecution,
        ]),
      ],
      providers: [
        ImportsService,
        JobsService,
        {
          provide: ShopifyAdminService,
          useValue: shopifyStub,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'uploads.dir' ? uploadDir : undefined,
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    imports = moduleRef.get(ImportsService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  const cleanup = async () => {
    await dataSource.query(`DELETE FROM csv_rows WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM jobs WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM csv_imports WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(`DELETE FROM suppliers WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
  };

  const shop = () => ({ id: SHOP, currency: 'USD' }) as Shop;

  beforeEach(async () => {
    await cleanup();
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'sheet', 'sheet.myshopify.com', 'ciphertext')`,
      [SHOP],
    );
    await dataSource.query(
      `INSERT INTO suppliers (id, shop_id, name) VALUES ($1, $2, 'Acme Supply')`,
      [SUPPLIER, SHOP],
    );
  });

  /** Derived, not hand-counted — the header is row 1. */
  const FIXTURE_DATA_ROWS = () => FIXTURE.split('\n').length - 1;

  const FIXTURE = [
    'SKU,Price,Compare At Price',
    'GOOD-1,19.99,29.99',
    'BAD-PRICE,not-a-number,',
    ',15.00,',
    'TWINS,12.00,',
    'MISSING,8.00,',
    'DUPE,5.00,',
    'DUPE,6.00,',
    'GOOD-2,22.50,',
  ].join('\n');

  const uploadFixture = async (content = FIXTURE) => {
    const record = await imports.upload(shop(), SUPPLIER, {
      originalname: 'acme-prices.csv',
      mimetype: 'text/csv',
      size: Buffer.byteLength(content),
      buffer: Buffer.from(content, 'utf8'),
    });
    // The upload wrote its own file; overwrite it with the fixture content so
    // the test controls exactly what is parsed.
    await mkdir(join(uploadDir, SHOP), { recursive: true });
    await writeFile(join(uploadDir, SHOP, `${record.id}.csv`), content, 'utf8');
    return record;
  };

  describe('upload', () => {
    it('creates the import and queues a parse job', async () => {
      const record = await uploadFixture();
      expect(record.status).toBe(CsvImportStatus.UPLOADED);

      const jobs: { type: string }[] = await dataSource.query(
        `SELECT type FROM jobs WHERE shop_id = $1 AND csv_import_id = $2`,
        [SHOP, record.id],
      );
      expect(jobs[0]?.type).toBe(JobType.CSV_PARSE);
    });

    it('refuses a file that is not a CSV', async () => {
      await expect(
        imports.upload(shop(), SUPPLIER, {
          originalname: 'prices.pdf',
          mimetype: 'application/pdf',
          size: 100,
          buffer: Buffer.from('x'),
        }),
      ).rejects.toThrow(/Export it from your spreadsheet/);
    });

    it('refuses a file over the size limit', async () => {
      await expect(
        imports.upload(shop(), SUPPLIER, {
          originalname: 'huge.csv',
          mimetype: 'text/csv',
          size: 50 * 1024 * 1024,
          buffer: Buffer.from('x'),
        }),
      ).rejects.toThrow(/The limit is/);
    });
  });

  describe('parse', () => {
    it('lands every row in the right status with its own reason', async () => {
      const record = await uploadFixture();
      const parsed = await imports.parse(SHOP, record.id);

      expect(parsed.status).toBe(CsvImportStatus.READY);
      expect(parsed.totalRows).toBe(FIXTURE_DATA_ROWS());

      const rows = await dataSource.query<
        { sku: string | null; status: string; error_message: string | null }[]
      >(
        `SELECT sku, status, error_message FROM csv_rows
          WHERE csv_import_id = $1 ORDER BY row_number`,
        [record.id],
      );

      expect(rows[0]).toMatchObject({
        sku: 'GOOD-1',
        status: CsvRowStatus.VALID,
      });
      expect(rows[1]?.status).toBe(CsvRowStatus.INVALID);
      expect(rows[1]?.error_message).toMatch(/not a price/);
      expect(rows[2]?.status).toBe(CsvRowStatus.INVALID);
      expect(rows[2]?.error_message).toMatch(/no SKU/);
      expect(rows[3]).toMatchObject({
        sku: 'TWINS',
        status: CsvRowStatus.VALID,
      });
      // Both DUPE rows, not just the second.
      expect(rows[5]?.error_message).toMatch(/appears 2 times/);
      expect(rows[6]?.error_message).toMatch(/appears 2 times/);
    });

    it('counts valid and invalid rows on the import', async () => {
      const record = await uploadFixture();
      const parsed = await imports.parse(SHOP, record.id);
      // Usable: GOOD-1, TWINS, MISSING, GOOD-2. Not: a bad price, a missing
      // SKU, and both halves of the duplicated one.
      expect(parsed.validRows + parsed.invalidRows).toBe(parsed.totalRows);
      expect(parsed.invalidRows).toBe(4);
      expect(parsed.validRows).toBe(4);
    });

    it('keeps the original row for support questions', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      const [row] = await dataSource.query<
        { raw_data: Record<string, string> }[]
      >(
        `SELECT raw_data FROM csv_rows WHERE csv_import_id = $1 AND sku = 'GOOD-1'`,
        [record.id],
      );
      expect(row?.raw_data).toMatchObject({ SKU: 'GOOD-1', Price: '19.99' });
    });

    it('fails the whole file when there is no SKU column', async () => {
      const record = await uploadFixture('name,price\nShirt,10.00');
      const parsed = await imports.parse(SHOP, record.id);
      expect(parsed.status).toBe(CsvImportStatus.FAILED);
      expect(parsed.errorMessage).toMatch(/needs a column for sku/);
    });

    it('re-parsing replaces rows rather than duplicating them', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      const again = await imports.parse(SHOP, record.id);
      expect(again.totalRows).toBe(FIXTURE_DATA_ROWS());
    });
  });

  describe('match', () => {
    it('resolves what it can and explains what it cannot', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      const matched = await imports.match(shop(), record.id);

      const rows = await dataSource.query<
        {
          sku: string;
          status: string;
          error_message: string | null;
          current_price: string | null;
        }[]
      >(
        `SELECT sku, status, error_message, current_price FROM csv_rows
          WHERE csv_import_id = $1 AND sku IS NOT NULL ORDER BY row_number`,
        [record.id],
      );
      const bySku = new Map(rows.map((row) => [row.sku, row]));

      expect(bySku.get('GOOD-1')?.status).toBe(CsvRowStatus.MATCHED);
      expect(bySku.get('GOOD-1')?.current_price).toBe('25.0000');
      expect(bySku.get('MISSING')?.status).toBe(CsvRowStatus.UNMATCHED);
      expect(bySku.get('MISSING')?.error_message).toMatch(/No product/);
      // Ambiguity is reported, never resolved by guessing.
      expect(bySku.get('TWINS')?.status).toBe(CsvRowStatus.UNMATCHED);
      expect(bySku.get('TWINS')?.error_message).toMatch(/2 products share/);

      expect(matched.matchedRows).toBe(2);
    });

    it('pre-fills the approved price from the sheet price', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      await imports.match(shop(), record.id);

      const [row] = await dataSource.query<{ approved_price: string }[]>(
        `SELECT approved_price FROM csv_rows
          WHERE csv_import_id = $1 AND sku = 'GOOD-1'`,
        [record.id],
      );
      // No campaign yet, so the supplier's price stands as-is.
      expect(row?.approved_price).toBe('19.9900');
    });

    it('makes the counters add up', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      const matched = await imports.match(shop(), record.id);
      expect(matched.validRows + matched.invalidRows).toBe(matched.totalRows);
      expect(matched.matchedRows).toBeLessThanOrEqual(matched.validRows);
    });
  });

  describe('merchant overrides', () => {
    const firstRowId = async (importId: string) => {
      const [row] = await dataSource.query<{ id: string }[]>(
        `SELECT id FROM csv_rows WHERE csv_import_id = $1 AND sku = 'GOOD-1'`,
        [importId],
      );
      return row.id;
    };

    it('accepts a valid price', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      const updated = await imports.overrideRow(
        SHOP,
        record.id,
        await firstRowId(record.id),
        { approvedPrice: '17.5000' },
      );
      expect(updated.approvedPrice).toBe('17.5000');
    });

    it.each([
      ['not-a-price', /four decimal places/],
      ['10.00001', /four decimal places/],
      ['-5.00', /greater than zero/],
      ['0', /greater than zero/],
    ])('rejects %s', async (value, pattern) => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      await expect(
        imports.overrideRow(SHOP, record.id, await firstRowId(record.id), {
          approvedPrice: value,
        }),
      ).rejects.toThrow(pattern);
    });

    it('lets a merchant drop a row without deleting it', async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      const updated = await imports.overrideRow(
        SHOP,
        record.id,
        await firstRowId(record.id),
        { excluded: true },
      );
      expect(updated.excluded).toBe(true);
    });
  });

  describe('approve', () => {
    const readyImport = async () => {
      const record = await uploadFixture();
      await imports.parse(SHOP, record.id);
      await imports.match(shop(), record.id);
      return record;
    };

    it('creates a SHEET campaign pointing at the import', async () => {
      const record = await readyImport();
      const campaign = await imports.approve(shop(), record.id);

      expect(campaign.priceSource).toBe('SHEET');
      expect(campaign.csvImportId).toBe(record.id);
      expect(campaign.status).toBe('DRAFT');
    });

    it('marks the import approved', async () => {
      const record = await readyImport();
      await imports.approve(shop(), record.id);
      const after = await imports.findImport(SHOP, record.id);
      expect(after.status).toBe(CsvImportStatus.APPROVED);
      expect(after.completedAt).not.toBeNull();
    });

    it('is idempotent — approving twice returns the same campaign', async () => {
      // A double-clicking merchant must not end up with two campaigns
      // repricing the same products.
      const record = await readyImport();
      const first = await imports.approve(shop(), record.id);
      const second = await imports.approve(shop(), record.id);
      expect(second.id).toBe(first.id);

      const [{ count }] = await dataSource.query<{ count: string }[]>(
        `SELECT count(*)::text FROM campaigns WHERE csv_import_id = $1`,
        [record.id],
      );
      expect(count).toBe('1');
    });

    it('refuses when nothing matched', async () => {
      const record = await uploadFixture('sku,price\nNOPE,10.00');
      await imports.parse(SHOP, record.id);
      await imports.match(shop(), record.id);

      await expect(imports.approve(shop(), record.id)).rejects.toThrow(
        /nothing to apply/,
      );
    });

    it('refuses when every matched row was excluded', async () => {
      const record = await readyImport();
      await dataSource.query(
        `UPDATE csv_rows SET excluded = true WHERE csv_import_id = $1`,
        [record.id],
      );
      await expect(imports.approve(shop(), record.id)).rejects.toThrow(
        /nothing to apply/,
      );
    });
  });
});
