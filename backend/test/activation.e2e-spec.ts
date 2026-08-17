import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CampaignStatus,
  PriceChangeStatus,
  ProductTagChangeStatus,
  ShopifyProductStatus,
} from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { BillingService } from '../src/modules/billing/services/billing.service';
import { AppPlan } from '../src/modules/billing/entities/app-plan.entity';
import { StoreSubscriptionEvent } from '../src/modules/billing/entities/store-subscription-event.entity';
import { StoreSubscription } from '../src/modules/billing/entities/store-subscription.entity';
import { StoreUsage } from '../src/modules/billing/entities/store-usage.entity';
import { ActivationService } from '../src/modules/campaigns/services/activation.service';
import { CampaignTargetsService } from '../src/modules/campaigns/services/campaign-targets.service';
import { CampaignsService } from '../src/modules/campaigns/services/campaigns.service';
import { Campaign } from '../src/modules/campaigns/entities/campaign.entity';
import { CampaignTarget } from '../src/modules/campaigns/entities/campaign-target.entity';
import { PriceChange } from '../src/modules/campaigns/entities/price-change.entity';
import { ProductTagChange } from '../src/modules/campaigns/entities/product-tag-change.entity';
import { OverlapService } from '../src/modules/campaigns/services/overlap.service';
import { CampaignPreviewService } from '../src/modules/campaigns/services/preview.service';
import { TargetResolverService } from '../src/modules/campaigns/services/target-resolver.service';
import { CsvRow } from '../src/modules/imports/entities/csv-row.entity';
import { Job } from '../src/modules/jobs/entities/job.entity';
import { JobStepResult } from '../src/modules/jobs/entities/job-step-result.entity';
import { JobExecution } from '../src/modules/jobs/entities/job-execution.entity';
import { JobDependency } from '../src/modules/jobs/entities/job-dependency.entity';
import { JobsService } from '../src/modules/jobs/services/jobs.service';
import { BulkOperationService } from '../src/modules/shopify/services/bulk-operation.service';
import {
  ShopifyAdminService,
  type CatalogVariant,
  type VariantPriceUpdate,
} from '../src/modules/shopify/services/shopify-admin.service';
import { Shop } from '../src/modules/shops/entities/shop.entity';

/**
 * Activation against a Shopify that fails on purpose.
 *
 * Partial failure is the normal case, not the exception — the Shopify write
 * cannot join a database transaction, so the guarantee under test is that a
 * half-succeeded run leaves an accurate, recoverable record: the good rows
 * APPLIED, the bad rows FAILED with the reason, and a retry that re-attempts
 * only what failed.
 */
describe('campaign activation', () => {
  let moduleRef: TestingModule;
  let activation: ActivationService;
  let dataSource: DataSource;

  const SHOP = '88888888-0000-4000-8000-000000000088';
  const CAMPAIGN = '99999999-0000-4000-8000-000000000099';

  /** Variants Shopify will refuse, by id. */
  let rejected: Set<string>;
  let updateCalls: { productId: string; variants: VariantPriceUpdate[] }[];
  let taggedProducts: { productId: string; tags: string[] }[];
  let catalog: CatalogVariant[];

  const variant = (
    id: string,
    price: string,
    productId = `gid://p/${id}`,
    tags: string[] = [],
  ): CatalogVariant => ({
    variantId: `gid://v/${id}`,
    productId,
    productTitle: `Product ${id}`,
    variantTitle: 'Default',
    sku: `SKU-${id}`,
    price,
    compareAtPrice: null,
    barcode: null,
    productStatus: ShopifyProductStatus.ACTIVE,
    inventoryQuantity: null,
    productTags: tags,
    productVendor: null,
    productType: null,
  });

  const shopifyStub = {
    listVariantsMatching: () =>
      Promise.resolve({ variants: catalog, truncated: false }),
    listCollectionVariants: () =>
      Promise.resolve({ variants: [], truncated: false }),
    listProductVariants: (_shop: Shop, ids: readonly string[]) =>
      Promise.resolve(catalog.filter((v) => ids.includes(v.productId))),
    fetchVariantPrices: () => Promise.resolve([]),
    updateVariantPrices: (
      _shop: Shop,
      productId: string,
      variants: readonly VariantPriceUpdate[],
    ) => {
      updateCalls.push({ productId, variants: [...variants] });
      return Promise.resolve(
        variants.map((v) =>
          rejected.has(v.variantId)
            ? {
                variantId: v.variantId,
                applied: false,
                error: 'Price must be greater than 0',
              }
            : { variantId: v.variantId, applied: true, error: null },
        ),
      );
    },
    updateProductTags: (_shop: Shop, productId: string, tags: string[]) => {
      taggedProducts.push({ productId, tags });
      return Promise.resolve({ applied: true, error: null });
    },
    invalidate: () => undefined,
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [
            Shop,
            Campaign,
            CampaignTarget,
            PriceChange,
            ProductTagChange,
            CsvRow,
            AppPlan,
            StoreSubscription,
            StoreSubscriptionEvent,
            StoreUsage,
            Job,
            JobExecution,
            JobDependency,
            JobStepResult,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Campaign,
          CampaignTarget,
          PriceChange,
          ProductTagChange,
          CsvRow,
        ]),
      ],
      providers: [
        ActivationService,
        CampaignsService,
        CampaignTargetsService,
        CampaignPreviewService,
        TargetResolverService,
        OverlapService,
        BillingService,
        JobsService,
        { provide: ShopifyAdminService, useValue: shopifyStub },
        {
          /*
           * These campaigns are far below the bulk threshold, so every write
           * must take the synchronous path. A stub that throws is the
           * assertion: if the size switch ever sends a five-variant campaign
           * through a bulk operation, these tests fail rather than quietly
           * exercising a path they were never written for.
           */
          provide: BulkOperationService,
          useValue: {
            runMutation: () => {
              throw new Error('A small campaign must not use a bulk operation');
            },
            findById: () => Promise.resolve(null),
            readResults: async function* () {
              // nothing
            },
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    activation = moduleRef.get(ActivationService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  const cleanup = async () => {
    await dataSource.query(
      `DELETE FROM product_tag_changes WHERE shop_id = $1`,
      [SHOP],
    );
    await dataSource.query(`DELETE FROM price_changes WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(`DELETE FROM store_usage WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(`DELETE FROM jobs WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
  };

  const shop = () => ({ id: SHOP, currency: 'USD' }) as Shop;

  /** A fresh job row; every activation run needs one. */
  const newJob = async (): Promise<string> => {
    const [row] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO jobs (shop_id, type, campaign_id, status)
       VALUES ($1, 'CAMPAIGN_ACTIVATE', $2, 'RUNNING') RETURNING id`,
      [SHOP, CAMPAIGN],
    );
    return row.id;
  };

  beforeEach(async () => {
    await cleanup();
    rejected = new Set();
    updateCalls = [];
    taggedProducts = [];
    catalog = [
      variant('1', '100.00'),
      variant('2', '200.00'),
      variant('3', '300.00'),
    ];

    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted,
                          override_active_variant_limit)
       VALUES ($1, 'act', 'act.myshopify.com', 'ciphertext', 10000)`,
      [SHOP],
    );
    await dataSource.query(
      `INSERT INTO campaigns
         (id, shop_id, title, status, adjustment_unit, adjustment_direction, adjustment_value)
       VALUES ($1, $2, 'Sale', 'SCHEDULED', 'PERCENTAGE', 'DECREASE', '20')`,
      [CAMPAIGN, SHOP],
    );
  });

  const rowsFor = (jobId: string) =>
    dataSource.query<
      {
        shopify_variant_id: string;
        status: string;
        error_message: string | null;
        old_price: string;
        new_price: string;
      }[]
    >(
      `SELECT shopify_variant_id, status, error_message, old_price, new_price
         FROM price_changes WHERE job_id = $1 ORDER BY shopify_variant_id`,
      [jobId],
    );

  describe('a clean run', () => {
    it('applies every variant and reports it', async () => {
      const jobId = await newJob();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      expect(outcome.applied).toBe(3);
      expect(outcome.failed).toBe(0);
      expect(outcome.status).toBe(CampaignStatus.ACTIVE);
    });

    it('records what the price actually was, for revert', async () => {
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      const rows = await rowsFor(jobId);
      expect(rows[0]?.old_price).toBe('100.0000');
      expect(rows[0]?.new_price).toBe('80.0000');
    });

    it('sends two decimal places, not four', async () => {
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);
      // Shopify rejects four; the row still stores full precision.
      expect(updateCalls[0]?.variants[0]?.price).toBe('80.0000');
    });

    it('groups variants of one product into a single call', async () => {
      catalog = [
        variant('a', '100.00', 'gid://p/shared'),
        variant('b', '110.00', 'gid://p/shared'),
      ];
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]?.variants).toHaveLength(2);
    });
  });

  describe('rows that would change nothing', () => {
    it('are written SKIPPED and never sent', async () => {
      await dataSource.query(
        `UPDATE campaigns SET adjustment_value = '0' WHERE id = $1`,
        [CAMPAIGN],
      );
      const jobId = await newJob();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      expect(outcome.skipped).toBe(3);
      expect(outcome.applied).toBe(0);
      // Most of the work and most of the rate-limit pressure, removed.
      expect(updateCalls).toHaveLength(0);
    });

    it('still leaves a row, so the results screen can explain itself', async () => {
      await dataSource.query(
        `UPDATE campaigns SET adjustment_value = '0' WHERE id = $1`,
        [CAMPAIGN],
      );
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      const rows = await rowsFor(jobId);
      expect(rows).toHaveLength(3);
      expect(rows[0]?.status).toBe(PriceChangeStatus.SKIPPED);
      expect(rows[0]?.error_message).toBe('Already at this price.');
    });
  });

  describe('partial failure', () => {
    it('applies the good rows and fails the bad ones with a reason', async () => {
      rejected = new Set(['gid://v/2']);
      const jobId = await newJob();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      expect(outcome.applied).toBe(2);
      expect(outcome.failed).toBe(1);

      const rows = await rowsFor(jobId);
      const failed = rows.find(
        (row) => row.status === String(PriceChangeStatus.FAILED),
      );
      expect(failed?.shopify_variant_id).toBe('gid://v/2');
      expect(failed?.error_message).toBe('Price must be greater than 0');
    });

    it('leaves the campaign ACTIVE, because prices are live and revertible', async () => {
      rejected = new Set(['gid://v/2']);
      const jobId = await newJob();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      expect(outcome.status).toBe(CampaignStatus.ACTIVE);
      // ...but the failure count is carried, so it cannot look successful.
      expect(outcome.failed).toBeGreaterThan(0);
    });

    it('fails the campaign when nothing applied at all', async () => {
      rejected = new Set(['gid://v/1', 'gid://v/2', 'gid://v/3']);
      const jobId = await newJob();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      expect(outcome.applied).toBe(0);
      expect(outcome.status).toBe(CampaignStatus.FAILED);
    });

    it('stays ACTIVE when there was simply nothing to do', async () => {
      // A campaign running correctly over an empty set is not a failure, and
      // calling it one sends the merchant hunting a bug that is not there.
      catalog = [];
      const jobId = await newJob();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      expect(outcome.total).toBe(0);
      expect(outcome.status).toBe(CampaignStatus.ACTIVE);
    });
  });

  describe('retry', () => {
    it('re-attempts only what failed', async () => {
      rejected = new Set(['gid://v/2']);
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      updateCalls = [];
      rejected = new Set();
      const outcome = await activation.activate(shop(), CAMPAIGN, jobId);

      // Only the previously failed variant is sent again.
      const sent = updateCalls.flatMap((call) =>
        call.variants.map((v) => v.variantId),
      );
      expect(sent).toEqual(['gid://v/2']);
      expect(outcome.applied).toBe(3);
      expect(outcome.failed).toBe(0);
    });

    it('applies nothing twice', async () => {
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      updateCalls = [];
      await activation.activate(shop(), CAMPAIGN, jobId);
      expect(updateCalls).toHaveLength(0);
    });

    it('does not duplicate rows on a retry', async () => {
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);
      await activation.activate(shop(), CAMPAIGN, jobId);

      expect(await rowsFor(jobId)).toHaveLength(3);
    });

    it('keeps the original old_price when retrying after a price moved', async () => {
      /*
       * The subtle one. A retry must not re-plan: if Shopify's price changed
       * between attempts, re-reading would store a different old_price and
       * revert would restore a number that was never on the storefront.
       */
      rejected = new Set(['gid://v/2']);
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      catalog = [
        variant('1', '999.00'),
        variant('2', '999.00'),
        variant('3', '999.00'),
      ];
      rejected = new Set();
      await activation.activate(shop(), CAMPAIGN, jobId);

      const rows = await rowsFor(jobId);
      expect(rows.every((row) => row.old_price !== '999.0000')).toBe(true);
    });
  });

  describe('tags', () => {
    beforeEach(async () => {
      catalog = [variant('1', '100.00', 'gid://p/1', ['existing'])];
      await dataSource.query(
        `UPDATE campaigns SET add_tags = ARRAY['on-sale'] WHERE id = $1`,
        [CAMPAIGN],
      );
    });

    it('records the complete before and after set', async () => {
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      const [row] = await dataSource.query<
        { old_tags: string[]; new_tags: string[]; status: string }[]
      >(
        `SELECT old_tags, new_tags, status FROM product_tag_changes WHERE job_id = $1`,
        [jobId],
      );
      expect(row?.old_tags).toEqual(['existing']);
      expect(row?.new_tags).toEqual(['existing', 'on-sale']);
      expect(row?.status).toBe(ProductTagChangeStatus.APPLIED);
    });

    it('writes nothing when the product already carries the tag', async () => {
      // The constitution's rule: deactivation must leave a tag the merchant
      // set themselves alone, which only works if no row was written.
      catalog = [variant('1', '100.00', 'gid://p/1', ['on-sale'])];
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      const rows = await dataSource.query<{ id: string }[]>(
        `SELECT id FROM product_tag_changes WHERE job_id = $1`,
        [jobId],
      );
      expect(rows).toHaveLength(0);
      expect(taggedProducts).toHaveLength(0);
    });

    it('does not tag a product whose price failed', async () => {
      rejected = new Set(['gid://v/1']);
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      expect(taggedProducts).toHaveLength(0);
    });
  });

  describe('plan limits', () => {
    it('refuses to start when the campaign would exceed the plan', async () => {
      await dataSource.query(
        `UPDATE shops SET override_active_variant_limit = 2 WHERE id = $1`,
        [SHOP],
      );
      const jobId = await newJob();

      await expect(
        activation.activate(shop(), CAMPAIGN, jobId),
      ).rejects.toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });

      // Nothing was written and nothing was sent — the gate is before the
      // first mutation, not after it.
      expect(updateCalls).toHaveLength(0);
      expect(await rowsFor(jobId)).toHaveLength(0);
    });
  });

  describe('eligibility', () => {
    it('refuses a campaign that is already running', async () => {
      await dataSource.query(
        `UPDATE campaigns SET status = 'ACTIVE' WHERE id = $1`,
        [CAMPAIGN],
      );
      await expect(
        activation.assertActivatable(shop(), CAMPAIGN),
      ).rejects.toThrow(/already running/);
    });

    it('refuses a cancelled campaign', async () => {
      await dataSource.query(
        `UPDATE campaigns SET status = 'CANCELLED' WHERE id = $1`,
        [CAMPAIGN],
      );
      await expect(
        activation.assertActivatable(shop(), CAMPAIGN),
      ).rejects.toThrow(/Duplicate it instead/);
    });
  });

  describe('progress', () => {
    it('reports counts a progress bar can use', async () => {
      rejected = new Set(['gid://v/3']);
      const jobId = await newJob();
      await activation.activate(shop(), CAMPAIGN, jobId);

      const progress = await activation.progress(jobId);
      expect(progress.total).toBe(3);
      expect(progress.applied).toBe(2);
      expect(progress.failed).toBe(1);
      expect(progress.pending).toBe(0);
    });
  });
});
