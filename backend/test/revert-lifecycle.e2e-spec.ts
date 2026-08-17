import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CampaignStatus,
  JobType,
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
import { RevertService } from '../src/modules/campaigns/services/revert.service';
import { CampaignSchedulerService } from '../src/modules/campaigns/services/scheduler.service';
import { TargetResolverService } from '../src/modules/campaigns/services/target-resolver.service';
import { CsvRow } from '../src/modules/imports/entities/csv-row.entity';
import { JobDependency } from '../src/modules/jobs/entities/job-dependency.entity';
import { JobExecution } from '../src/modules/jobs/entities/job-execution.entity';
import { Job } from '../src/modules/jobs/entities/job.entity';
import { JobStepResult } from '../src/modules/jobs/entities/job-step-result.entity';
import { JobsService } from '../src/modules/jobs/services/jobs.service';
import { BulkOperationService } from '../src/modules/shopify/services/bulk-operation.service';
import {
  ShopifyAdminService,
  type CatalogVariant,
  type VariantPriceUpdate,
} from '../src/modules/shopify/services/shopify-admin.service';
import { Shop } from '../src/modules/shops/entities/shop.entity';

/**
 * Schedule → activate → deactivate, against a Shopify that remembers.
 *
 * The stub keeps live prices in a map and mutates them, so the assertions are
 * about what the storefront would actually show rather than about which
 * methods were called. Two cases carry the phase: a product that was *already
 * on sale* before the campaign, and one whose price a merchant edited while
 * the campaign was running.
 */
describe('campaign lifecycle', () => {
  let moduleRef: TestingModule;
  let activation: ActivationService;
  let revert: RevertService;
  let scheduler: CampaignSchedulerService;
  let dataSource: DataSource;

  const SHOP = 'aaaa1111-0000-4000-8000-00000000aa11';
  const CAMPAIGN = 'bbbb2222-0000-4000-8000-00000000bb22';

  /** Live Shopify state, mutated by the stub as the test proceeds. */
  let live: Map<string, CatalogVariant>;
  let liveTags: Map<string, string[]>;

  const variant = (
    id: string,
    price: string,
    compareAt: string | null = null,
  ): CatalogVariant => ({
    variantId: `gid://v/${id}`,
    productId: `gid://p/${id}`,
    productTitle: `Product ${id}`,
    variantTitle: 'Default',
    sku: `SKU-${id}`,
    price,
    compareAtPrice: compareAt,
    barcode: null,
    productStatus: ShopifyProductStatus.ACTIVE,
    inventoryQuantity: null,
    productTags: [],
    productVendor: null,
    productType: null,
  });

  const shopifyStub = {
    listVariantsMatching: () =>
      Promise.resolve({
        variants: [...live.values()].map((v) => ({
          ...v,
          productTags: liveTags.get(v.productId) ?? [],
        })),
        truncated: false,
      }),
    listCollectionVariants: () =>
      Promise.resolve({ variants: [], truncated: false }),
    listProductVariants: (_shop: Shop, ids: readonly string[]) =>
      Promise.resolve(
        [...live.values()]
          .filter((v) => ids.includes(v.productId))
          .map((v) => ({ ...v, productTags: liveTags.get(v.productId) ?? [] })),
      ),
    fetchVariantPrices: (_shop: Shop, ids: readonly string[]) =>
      Promise.resolve(
        ids
          .map((id) => live.get(id))
          .filter((v): v is CatalogVariant => v !== undefined),
      ),
    updateVariantPrices: (
      _shop: Shop,
      _productId: string,
      variants: readonly VariantPriceUpdate[],
    ) =>
      Promise.resolve(
        variants.map((update) => {
          const current = live.get(update.variantId);
          if (!current) {
            return {
              variantId: update.variantId,
              applied: false,
              error: 'Not found',
            };
          }
          // Shopify actually stores it — later reads see the new value.
          live.set(update.variantId, {
            ...current,
            price: update.price,
            compareAtPrice: update.compareAtPrice,
          });
          return { variantId: update.variantId, applied: true, error: null };
        }),
      ),
    updateProductTags: (_shop: Shop, productId: string, tags: string[]) => {
      liveTags.set(productId, [...tags]);
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
        RevertService,
        CampaignSchedulerService,
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
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'scheduler.enabled'
                ? 'false'
                : key === 'scheduler.activationGraceMs'
                  ? 3_600_000
                  : undefined,
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    activation = moduleRef.get(ActivationService);
    revert = moduleRef.get(RevertService);
    scheduler = moduleRef.get(CampaignSchedulerService);
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
    await dataSource.query(`DELETE FROM job_dependencies WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(`DELETE FROM jobs WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
  };

  const shop = () => ({ id: SHOP, currency: 'USD' }) as Shop;

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
    live = new Map([
      ['gid://v/plain', variant('plain', '100.0000')],
      // Already on sale: 80 now, was 150. Revert must restore *both*.
      ['gid://v/onsale', variant('onsale', '80.0000', '150.0000')],
    ]);
    liveTags = new Map();

    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted,
                          override_active_variant_limit)
       VALUES ($1, 'life', 'life.myshopify.com', 'ciphertext', 10000)`,
      [SHOP],
    );
    await dataSource.query(
      `INSERT INTO campaigns
         (id, shop_id, title, status, adjustment_unit, adjustment_direction,
          adjustment_value, set_compare_at)
       VALUES ($1, $2, 'Weekend sale', 'SCHEDULED', 'PERCENTAGE', 'DECREASE', '20', true)`,
      [CAMPAIGN, SHOP],
    );
  });

  const priceOf = (id: string) => live.get(`gid://v/${id}`)?.price;
  const compareAtOf = (id: string) => live.get(`gid://v/${id}`)?.compareAtPrice;

  describe('the round trip', () => {
    it('applies, then puts everything back exactly', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());

      expect(priceOf('plain')).toBe('80.0000');
      expect(priceOf('onsale')).toBe('64.0000');

      const outcome = await revert.revert(shop(), CAMPAIGN);

      expect(outcome.reverted).toBe(2);
      expect(priceOf('plain')).toBe('100.0000');
      expect(priceOf('onsale')).toBe('80.0000');
      expect(outcome.status).toBe(CampaignStatus.COMPLETED);
    });

    it('gives a product that was already on sale its earlier sale price back', async () => {
      // The case both `old_*` columns exist for. Before: 80, struck through at
      // 150. The campaign moves it to 64 and strikes through 80. Revert must
      // restore 80/150 — not 80/full-price, and not 150 as the price.
      await activation.activate(shop(), CAMPAIGN, await newJob());
      expect(compareAtOf('onsale')).toBe('80.0000');

      await revert.revert(shop(), CAMPAIGN);
      expect(priceOf('onsale')).toBe('80.0000');
      expect(compareAtOf('onsale')).toBe('150.0000');
    });

    it('marks the rows REVERTED with a timestamp', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());
      await revert.revert(shop(), CAMPAIGN);

      const rows = await dataSource.query<
        { status: PriceChangeStatus; reverted_at: Date | null }[]
      >(
        `SELECT status, reverted_at FROM price_changes WHERE campaign_id = $1`,
        [CAMPAIGN],
      );
      expect(
        rows.every((row) => row.status === PriceChangeStatus.REVERTED),
      ).toBe(true);
      expect(rows.every((row) => row.reverted_at !== null)).toBe(true);
    });
  });

  describe('a price somebody else changed', () => {
    it('is left alone, with a reason', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());

      // The merchant edits it in the Shopify admin mid-sale.
      live.set('gid://v/plain', variant('plain', '55.0000'));

      const outcome = await revert.revert(shop(), CAMPAIGN);

      // Overwriting a deliberate manual change is worse than leaving it.
      expect(priceOf('plain')).toBe('55.0000');
      expect(outcome.skipped).toBe(1);
      expect(outcome.reverted).toBe(1);

      const [row] = await dataSource.query<
        { status: string; error_message: string }[]
      >(
        `SELECT status, error_message FROM price_changes
          WHERE campaign_id = $1 AND shopify_variant_id = 'gid://v/plain'`,
        [CAMPAIGN],
      );
      expect(row?.status).toBe(PriceChangeStatus.SKIPPED);
      expect(row?.error_message).toMatch(/changed to 55/);
    });

    it('does not stop the other variants being restored', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());
      live.set('gid://v/plain', variant('plain', '55.0000'));

      await revert.revert(shop(), CAMPAIGN);
      expect(priceOf('onsale')).toBe('80.0000');
    });

    it('skips a variant that has been deleted', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());
      live.delete('gid://v/plain');

      const outcome = await revert.revert(shop(), CAMPAIGN);
      expect(outcome.skipped).toBe(1);
    });
  });

  describe('tags', () => {
    beforeEach(async () => {
      liveTags.set('gid://p/plain', ['seasonal']);
      liveTags.set('gid://p/onsale', ['on-sale']);
      await dataSource.query(
        `UPDATE campaigns SET add_tags = ARRAY['on-sale'] WHERE id = $1`,
        [CAMPAIGN],
      );
    });

    it('restores the exact set it replaced', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());
      expect(liveTags.get('gid://p/plain')).toEqual(['seasonal', 'on-sale']);

      await revert.revert(shop(), CAMPAIGN);
      expect(liveTags.get('gid://p/plain')).toEqual(['seasonal']);
    });

    it('leaves a tag the merchant already had', async () => {
      // No row was written for this product, because its tag set did not
      // change — so revert has nothing to undo, and the merchant's own
      // `on-sale` tag survives.
      await activation.activate(shop(), CAMPAIGN, await newJob());
      await revert.revert(shop(), CAMPAIGN);
      expect(liveTags.get('gid://p/onsale')).toEqual(['on-sale']);
    });

    it('marks the tag rows REVERTED', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());
      const outcome = await revert.revert(shop(), CAMPAIGN);

      expect(outcome.tagsReverted).toBe(1);
      const rows = await dataSource.query<{ status: string }[]>(
        `SELECT status FROM product_tag_changes WHERE campaign_id = $1`,
        [CAMPAIGN],
      );
      expect(rows[0]?.status).toBe(ProductTagChangeStatus.REVERTED);
    });
  });

  describe('resumability', () => {
    it('re-running a finished revert changes nothing', async () => {
      await activation.activate(shop(), CAMPAIGN, await newJob());
      await revert.revert(shop(), CAMPAIGN);

      const second = await revert.revert(shop(), CAMPAIGN);
      expect(second.total).toBe(0);
      expect(priceOf('plain')).toBe('100.0000');
    });

    it('restores to the original after two activations without a revert', async () => {
      /*
       * 100 → 80 on the first run, 80 → 64 on the second. The second row's
       * `old_price` is 80, which this campaign set — restoring that would
       * leave half its own effect in place. The oldest row's 100 is what "put
       * it back" means.
       */
      await activation.activate(shop(), CAMPAIGN, await newJob());
      await dataSource.query(
        `UPDATE campaigns SET status = 'SCHEDULED' WHERE id = $1`,
        [CAMPAIGN],
      );
      await activation.activate(shop(), CAMPAIGN, await newJob());
      expect(priceOf('plain')).toBe('64.0000');

      await revert.revert(shop(), CAMPAIGN);
      expect(priceOf('plain')).toBe('100.0000');
    });
  });

  describe('the scheduler', () => {
    const setSchedule = (
      start: string | null,
      end: string | null,
      status: string,
    ) =>
      dataSource.query(
        `UPDATE campaigns SET start_at = $2, end_at = $3, status = $4 WHERE id = $1`,
        [CAMPAIGN, start, end, status],
      );

    const jobsOf = () =>
      dataSource.query<{ type: string; priority: number }[]>(
        `SELECT type, priority FROM jobs WHERE shop_id = $1 AND campaign_id = $2
           AND status <> 'RUNNING'`,
        [SHOP, CAMPAIGN],
      );

    it('starts a campaign that has come due', async () => {
      await setSchedule('2026-08-14T09:00:00Z', null, 'SCHEDULED');
      const result = await scheduler.sweep(new Date('2026-08-14T09:00:30Z'));

      expect(result.activated).toBe(1);
      expect((await jobsOf())[0]?.type).toBe(JobType.CAMPAIGN_ACTIVATE);
    });

    it('leaves a campaign that is not due yet', async () => {
      await setSchedule('2026-08-20T09:00:00Z', null, 'SCHEDULED');
      const result = await scheduler.sweep(new Date('2026-08-14T09:00:00Z'));

      expect(result.activated).toBe(0);
      expect(await jobsOf()).toHaveLength(0);
    });

    it('starts one that is late but inside the grace period', async () => {
      // A sale twenty minutes behind schedule is still what the merchant
      // wanted.
      await setSchedule('2026-08-14T09:00:00Z', null, 'SCHEDULED');
      const result = await scheduler.sweep(new Date('2026-08-14T09:20:00Z'));
      expect(result.activated).toBe(1);
    });

    it('abandons one that missed its window entirely', async () => {
      // Starting a Black Friday sale on the Monday after is worse than not
      // starting it.
      await setSchedule('2026-08-14T09:00:00Z', null, 'SCHEDULED');
      const result = await scheduler.sweep(new Date('2026-08-16T09:00:00Z'));

      expect(result.missed).toBe(1);
      expect(result.activated).toBe(0);

      const [row] = await dataSource.query<{ status: string }[]>(
        `SELECT status FROM campaigns WHERE id = $1`,
        [CAMPAIGN],
      );
      expect(row?.status).toBe(CampaignStatus.FAILED);
    });

    it('ends a campaign however late it is — there is no grace here', async () => {
      /*
       * The worst bug this app could have: prices staying discounted because
       * a worker was offline. Deactivation has no grace period at all.
       */
      await setSchedule(
        '2026-08-01T09:00:00Z',
        '2026-08-02T09:00:00Z',
        'ACTIVE',
      );
      const result = await scheduler.sweep(new Date('2026-08-30T09:00:00Z'));

      expect(result.deactivated).toBe(1);
      const jobs = await jobsOf();
      expect(jobs[0]?.type).toBe(JobType.CAMPAIGN_REVERT);
    });

    it('queues a revert ahead of an activation', async () => {
      await setSchedule(
        '2026-08-01T09:00:00Z',
        '2026-08-02T09:00:00Z',
        'ACTIVE',
      );
      await scheduler.sweep(new Date('2026-08-30T09:00:00Z'));
      expect((await jobsOf())[0]?.priority).toBe(10);
    });

    it('does not queue the same campaign twice', async () => {
      // Two sweeps, or two schedulers, collapse onto one job through the
      // dedup key — no CLAIMED status needed.
      await setSchedule('2026-08-14T09:00:00Z', null, 'SCHEDULED');
      await scheduler.sweep(new Date('2026-08-14T09:00:30Z'));
      await scheduler.sweep(new Date('2026-08-14T09:00:40Z'));

      expect(await jobsOf()).toHaveLength(1);
    });

    it('ignores a soft-deleted campaign', async () => {
      await setSchedule('2026-08-14T09:00:00Z', null, 'SCHEDULED');
      await dataSource.query(
        `UPDATE campaigns SET deleted_at = now() WHERE id = $1`,
        [CAMPAIGN],
      );
      const result = await scheduler.sweep(new Date('2026-08-14T09:00:30Z'));
      expect(result.activated).toBe(0);
    });
  });
});
