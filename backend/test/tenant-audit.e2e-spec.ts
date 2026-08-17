import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsvRowStatus } from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { BillingService } from '../src/modules/billing/services/billing.service';
import { AppPlan } from '../src/modules/billing/entities/app-plan.entity';
import { StoreSubscriptionEvent } from '../src/modules/billing/entities/store-subscription-event.entity';
import { StoreSubscription } from '../src/modules/billing/entities/store-subscription.entity';
import { StoreUsage } from '../src/modules/billing/entities/store-usage.entity';
import { CampaignTargetsService } from '../src/modules/campaigns/services/campaign-targets.service';
import { CampaignsService } from '../src/modules/campaigns/services/campaigns.service';
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
import { SuppliersService } from '../src/modules/suppliers/services/suppliers.service';

/**
 * Shop A trying to read shop B, resource by resource.
 *
 * The composite foreign keys make a cross-tenant *write* unrepresentable. They
 * do nothing about a **read** with a forgotten `WHERE shop_id` — that is a
 * convention, and conventions need testing. Every service that takes a
 * `shopId` is exercised here with the wrong one.
 *
 * A failure in this file is a data breach, not a bug.
 */
describe('tenant isolation across every resource', () => {
  let moduleRef: TestingModule;
  let campaigns: CampaignsService;
  let targets: CampaignTargetsService;
  let suppliers: SuppliersService;
  let imports: ImportsService;
  let billing: BillingService;
  let jobs: JobsService;
  let dataSource: DataSource;

  const SHOP_A = 'dddd4444-0000-4000-8000-00000000dd44';
  const SHOP_B = 'eeee5555-0000-4000-8000-00000000ee55';

  /** Everything shop B owns. Shop A must not see any of it. */
  const B = {
    campaign: 'ffff6666-0000-4000-8000-00000000ff01',
    supplier: 'ffff6666-0000-4000-8000-00000000ff02',
    csvImport: 'ffff6666-0000-4000-8000-00000000ff03',
    job: 'ffff6666-0000-4000-8000-00000000ff04',
    target: 'ffff6666-0000-4000-8000-00000000ff05',
    csvRow: 'ffff6666-0000-4000-8000-00000000ff06',
  };

  beforeAll(async () => {
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
            AppPlan,
            StoreSubscription,
            StoreSubscriptionEvent,
            StoreUsage,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Campaign,
          CampaignTarget,
          PriceChange,
          ProductTagChange,
          Supplier,
          CsvImport,
          CsvRow,
        ]),
      ],
      providers: [
        CampaignsService,
        CampaignTargetsService,
        SuppliersService,
        ImportsService,
        BillingService,
        JobsService,
        { provide: ShopifyAdminService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    await moduleRef.init();
    campaigns = moduleRef.get(CampaignsService);
    targets = moduleRef.get(CampaignTargetsService);
    suppliers = moduleRef.get(SuppliersService);
    imports = moduleRef.get(ImportsService);
    billing = moduleRef.get(BillingService);
    jobs = moduleRef.get(JobsService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  const cleanup = async () => {
    for (const table of [
      'price_changes',
      'job_dependencies',
      'job_executions',
      'jobs',
      'campaign_targets',
      'campaigns',
      'csv_rows',
      'csv_imports',
      'suppliers',
      'store_usage',
    ]) {
      await dataSource.query(
        `DELETE FROM "${table}" WHERE shop_id IN ($1, $2)`,
        [SHOP_A, SHOP_B],
      );
    }
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
  };

  beforeAll(async () => {
    await cleanup();
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'aud-a', 'aud-a.myshopify.com', 'x'),
              ($2, 'aud-b', 'aud-b.myshopify.com', 'x')`,
      [SHOP_A, SHOP_B],
    );

    // Shop B's data.
    await dataSource.query(
      `INSERT INTO suppliers (id, shop_id, name) VALUES ($1, $2, 'B Supply')`,
      [B.supplier, SHOP_B],
    );
    await dataSource.query(
      `INSERT INTO csv_imports (id, shop_id, supplier_id, file_name)
       VALUES ($1, $2, $3, 'b.csv')`,
      [B.csvImport, SHOP_B, B.supplier],
    );
    await dataSource.query(
      `INSERT INTO csv_rows (id, shop_id, csv_import_id, row_number, raw_data, sku, status)
       VALUES ($1, $2, $3, 2, '{}', 'B-SKU', $4)`,
      [B.csvRow, SHOP_B, B.csvImport, CsvRowStatus.MATCHED],
    );
    await dataSource.query(
      `INSERT INTO campaigns (id, shop_id, title) VALUES ($1, $2, 'B secret sale')`,
      [B.campaign, SHOP_B],
    );
    await dataSource.query(
      `INSERT INTO campaign_targets (id, shop_id, campaign_id, mode, target_type, target_value)
       VALUES ($1, $2, $3, 'INCLUDE', 'VENDOR', 'b-vendor')`,
      [B.target, SHOP_B, B.campaign],
    );
    await dataSource.query(
      `INSERT INTO jobs (id, shop_id, type, campaign_id)
       VALUES ($1, $2, 'CAMPAIGN_ACTIVATE', $3)`,
      [B.job, SHOP_B, B.campaign],
    );
    await dataSource.query(
      `INSERT INTO price_changes
         (shop_id, campaign_id, job_id, shopify_product_id, shopify_variant_id,
          product_title, old_price, new_price, status)
       VALUES ($1, $2, $3, 'gid://p/b', 'gid://v/b', 'B Product', '100.0000', '80.0000', 'APPLIED')`,
      [SHOP_B, B.campaign, B.job],
    );
  });

  describe('campaigns', () => {
    it('cannot be fetched by id from another shop', async () => {
      await expect(campaigns.findOne(SHOP_A, B.campaign)).rejects.toThrow(
        /not found/i,
      );
    });

    it('do not appear in another shop’s list', async () => {
      const list = await campaigns.list(SHOP_A, {});
      expect(list.items).toHaveLength(0);
      expect(list.totalItems).toBe(0);
    });

    it('cannot be edited from another shop', async () => {
      await expect(
        campaigns.update(SHOP_A, B.campaign, { title: 'hijacked' }),
      ).rejects.toThrow(/not found/i);

      const [row] = await dataSource.query<{ title: string }[]>(
        `SELECT title FROM campaigns WHERE id = $1`,
        [B.campaign],
      );
      expect(row?.title).toBe('B secret sale');
    });

    it('cannot be deleted from another shop', async () => {
      await expect(campaigns.remove(SHOP_A, B.campaign)).rejects.toThrow(
        /not found/i,
      );
    });

    it('cannot have their status changed from another shop', async () => {
      await expect(
        campaigns.changeStatus(SHOP_A, B.campaign, 'ACTIVE' as never),
      ).rejects.toThrow(/not found/i);
    });

    it('do not leak through results or progress', async () => {
      await expect(campaigns.results(SHOP_A, B.campaign)).rejects.toThrow(
        /not found/i,
      );
      await expect(campaigns.progress(SHOP_A, B.campaign)).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('campaign targets', () => {
    it('are not listed for another shop', async () => {
      expect(await targets.list(SHOP_A, B.campaign)).toHaveLength(0);
    });

    it('report zero counts for another shop', async () => {
      const counts = await targets.countByMode(SHOP_A, B.campaign);
      expect(counts.INCLUDE).toBe(0);
      expect(counts.EXCLUDE).toBe(0);
    });

    it('cannot be deleted by id from another shop', async () => {
      await targets.removeById(SHOP_A, B.campaign, B.target);
      const [row] = await dataSource.query<{ id: string }[]>(
        `SELECT id FROM campaign_targets WHERE id = $1`,
        [B.target],
      );
      expect(row).toBeDefined();
    });
  });

  describe('suppliers', () => {
    it('cannot be fetched from another shop', async () => {
      await expect(suppliers.findOne(SHOP_A, B.supplier)).rejects.toThrow(
        /not found/i,
      );
    });

    it('do not appear in another shop’s list', async () => {
      expect((await suppliers.list(SHOP_A, {})).items).toHaveLength(0);
    });

    it('cannot be updated or deleted from another shop', async () => {
      await expect(
        suppliers.update(SHOP_A, B.supplier, { name: 'hijacked' }),
      ).rejects.toThrow(/not found/i);
      await expect(suppliers.remove(SHOP_A, B.supplier)).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('imports and their rows', () => {
    it('cannot be fetched from another shop', async () => {
      await expect(imports.findImport(SHOP_A, B.csvImport)).rejects.toThrow(
        /not found/i,
      );
    });

    it('do not list another shop’s rows', async () => {
      const rows = await imports.listRows(SHOP_A, B.csvImport, {});
      expect(rows.items).toHaveLength(0);
      expect(rows.totalItems).toBe(0);
    });

    it('cannot have a row overridden from another shop', async () => {
      // The one that would let a merchant reprice a competitor's catalogue.
      await expect(
        imports.overrideRow(SHOP_A, B.csvImport, B.csvRow, {
          approvedPrice: '0.0100',
        }),
      ).rejects.toThrow(/not found/i);

      const [row] = await dataSource.query<{ approved_price: string | null }[]>(
        `SELECT approved_price FROM csv_rows WHERE id = $1`,
        [B.csvRow],
      );
      expect(row?.approved_price).toBeNull();
    });
  });

  describe('jobs', () => {
    it('cannot be fetched from another shop', async () => {
      expect(await jobs.findById(SHOP_A, B.job)).toBeNull();
    });

    it('cannot be cancelled from another shop', async () => {
      await expect(jobs.requestCancel(SHOP_A, B.job)).rejects.toThrow();
    });

    it('cannot be paused from another shop', async () => {
      await jobs.pause(SHOP_A, B.job);
      const [row] = await dataSource.query<{ status: string }[]>(
        `SELECT status FROM jobs WHERE id = $1`,
        [B.job],
      );
      expect(row?.status).not.toBe('PAUSED');
    });
  });

  describe('billing', () => {
    it('counts only the asking shop’s usage', async () => {
      // Shop B has an applied price change; shop A must see none of it, or one
      // merchant's catalogue size would consume another's plan.
      const usage = await billing.computeUsage(SHOP_A);
      expect(usage.activeVariantCount).toBe(0);
      expect(usage.activeCampaignCount).toBe(0);
    });

    it('does not count another shop’s variants against a quota', async () => {
      const result = await billing.checkActivationQuota(SHOP_A, B.campaign, [
        'gid://v/a1',
      ]);
      if (!result.allowed) throw new Error('expected the activation to fit');
      expect(result.allowed).toBe(true);
    });
  });

  describe('the write side is unrepresentable, not merely guarded', () => {
    it('refuses a price change referencing another shop’s campaign', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO price_changes
             (shop_id, campaign_id, job_id, shopify_product_id, shopify_variant_id,
              product_title, old_price, new_price)
           VALUES ($1, $2, $3, 'gid://p/x', 'gid://v/x', 'X', '10.0000', '9.0000')`,
          [SHOP_A, B.campaign, B.job],
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('refuses a target referencing another shop’s campaign', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO campaign_targets (shop_id, campaign_id, mode, target_type, target_value)
           VALUES ($1, $2, 'INCLUDE', 'TAG', 'x')`,
          [SHOP_A, B.campaign],
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('refuses a csv row referencing another shop’s import', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO csv_rows (shop_id, csv_import_id, row_number, raw_data)
           VALUES ($1, $2, 99, '{}')`,
          [SHOP_A, B.csvImport],
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });
  });
});
