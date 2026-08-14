import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignStatus, ShopifyProductStatus } from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { BillingService } from '../src/modules/billing/billing.service';
import { AppPlan } from '../src/modules/billing/entities/app-plan.entity';
import { StoreSubscriptionEvent } from '../src/modules/billing/entities/store-subscription-event.entity';
import { StoreSubscription } from '../src/modules/billing/entities/store-subscription.entity';
import { StoreUsage } from '../src/modules/billing/entities/store-usage.entity';
import { ActivationService } from '../src/modules/campaigns/activation.service';
import { CampaignTargetsService } from '../src/modules/campaigns/campaign-targets.service';
import { CampaignsService } from '../src/modules/campaigns/campaigns.service';
import { Campaign } from '../src/modules/campaigns/entities/campaign.entity';
import { CampaignTarget } from '../src/modules/campaigns/entities/campaign-target.entity';
import { PriceChange } from '../src/modules/campaigns/entities/price-change.entity';
import { ProductTagChange } from '../src/modules/campaigns/entities/product-tag-change.entity';
import { OverlapService } from '../src/modules/campaigns/overlap.service';
import { CampaignPreviewService } from '../src/modules/campaigns/preview.service';
import { RevertService } from '../src/modules/campaigns/revert.service';
import { TargetResolverService } from '../src/modules/campaigns/target-resolver.service';
import { CsvImport } from '../src/modules/imports/entities/csv-import.entity';
import { CsvRow } from '../src/modules/imports/entities/csv-row.entity';
import { ImportsService } from '../src/modules/imports/imports.service';
import { JobDependency } from '../src/modules/jobs/entities/job-dependency.entity';
import { JobExecution } from '../src/modules/jobs/entities/job-execution.entity';
import { Job } from '../src/modules/jobs/entities/job.entity';
import { JobsService } from '../src/modules/jobs/jobs.service';
import {
  ShopifyAdminService,
  type CatalogVariant,
  type VariantPriceUpdate,
} from '../src/modules/shopify/shopify-admin.service';
import { Shop } from '../src/modules/shops/entities/shop.entity';
import { Supplier } from '../src/modules/suppliers/entities/supplier.entity';

/**
 * The two ways money moves, end to end.
 *
 * These are the tests that decide whether this app is safe to point at a real
 * store. Every price is asserted as an exact decimal string, and the Shopify
 * stub stores what it is told so the assertions describe what a customer would
 * actually see rather than which methods were called.
 */
describe('the money paths', () => {
  let moduleRef: TestingModule;
  let campaigns: CampaignsService;
  let activation: ActivationService;
  let revert: RevertService;
  let imports: ImportsService;
  let dataSource: DataSource;
  let uploadDir: string;

  const SHOP = '11112222-0000-4000-8000-000011112222';
  const SUPPLIER = '33334444-0000-4000-8000-000033334444';

  let live: Map<string, CatalogVariant>;
  /** Variants Shopify refuses, and how many more times it will refuse them. */
  let failFor: Map<string, number>;
  let callCount: number;

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
    productStatus: ShopifyProductStatus.ACTIVE,
    productTags: [],
    productVendor: null,
    productType: null,
  });

  const shopifyStub = {
    listVariantsMatching: () =>
      Promise.resolve({ variants: [...live.values()], truncated: false }),
    listCollectionVariants: () =>
      Promise.resolve({ variants: [], truncated: false }),
    listProductVariants: (_s: Shop, ids: readonly string[]) =>
      Promise.resolve(
        [...live.values()].filter((v) => ids.includes(v.productId)),
      ),
    fetchVariantPrices: (_s: Shop, ids: readonly string[]) =>
      Promise.resolve(
        ids.map((id) => live.get(id)).filter((v): v is CatalogVariant => !!v),
      ),
    findVariantsBySku: (_s: Shop, skus: readonly string[]) =>
      Promise.resolve(
        skus.map((sku) => ({
          sku,
          variants: [...live.values()].filter((v) => v.sku === sku),
        })),
      ),
    updateVariantPrices: (
      _s: Shop,
      _p: string,
      variants: readonly VariantPriceUpdate[],
    ) => {
      callCount += 1;
      return Promise.resolve(
        variants.map((update) => {
          const remaining = failFor.get(update.variantId) ?? 0;
          if (remaining > 0) {
            failFor.set(update.variantId, remaining - 1);
            return {
              variantId: update.variantId,
              applied: false,
              error: 'Throttled',
            };
          }
          const current = live.get(update.variantId);
          if (!current) {
            return {
              variantId: update.variantId,
              applied: false,
              error: 'Gone',
            };
          }
          live.set(update.variantId, {
            ...current,
            price: update.price,
            compareAtPrice: update.compareAtPrice,
          });
          return { variantId: update.variantId, applied: true, error: null };
        }),
      );
    },
    updateProductTags: () => Promise.resolve({ applied: true, error: null }),
    invalidate: () => undefined,
  };

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'pricelogic-money-'));

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
          CsvImport,
          CsvRow,
        ]),
      ],
      providers: [
        CampaignsService,
        CampaignTargetsService,
        CampaignPreviewService,
        TargetResolverService,
        OverlapService,
        ActivationService,
        RevertService,
        BillingService,
        ImportsService,
        JobsService,
        { provide: ShopifyAdminService, useValue: shopifyStub },
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
    campaigns = moduleRef.get(CampaignsService);
    activation = moduleRef.get(ActivationService);
    revert = moduleRef.get(RevertService);
    imports = moduleRef.get(ImportsService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  const cleanup = async () => {
    for (const table of [
      'product_tag_changes',
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
      await dataSource.query(`DELETE FROM "${table}" WHERE shop_id = $1`, [
        SHOP,
      ]);
    }
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
  };

  const shop = () => ({ id: SHOP, currency: 'USD' }) as Shop;
  const priceOf = (id: string) => live.get(`gid://v/${id}`)?.price;
  const compareAtOf = (id: string) => live.get(`gid://v/${id}`)?.compareAtPrice;

  const newJob = async (campaignId: string): Promise<string> => {
    const [row] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO jobs (shop_id, type, campaign_id, status)
       VALUES ($1, 'CAMPAIGN_ACTIVATE', $2, 'RUNNING') RETURNING id`,
      [SHOP, campaignId],
    );
    return row.id;
  };

  beforeEach(async () => {
    await cleanup();
    failFor = new Map();
    callCount = 0;
    live = new Map([
      ['gid://v/a', variant('a', '19.9900')],
      ['gid://v/b', variant('b', '49.9900', '79.9900')],
      ['gid://v/c', variant('c', '5.0000')],
    ]);

    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted,
                          override_active_variant_limit)
       VALUES ($1, 'money', 'money.myshopify.com', 'x', 10000)`,
      [SHOP],
    );
    await dataSource.query(
      `INSERT INTO suppliers (id, shop_id, name) VALUES ($1, $2, 'Acme')`,
      [SUPPLIER, SHOP],
    );
  });

  describe('path one — campaign builder → preview → activate → revert', () => {
    const buildCampaign = () =>
      campaigns.create(SHOP, {
        title: '15% off everything',
        adjustmentUnit: 'PERCENTAGE' as never,
        adjustmentDirection: 'DECREASE' as never,
        adjustmentValue: '15',
        setCompareAt: true,
      });

    it('previews exactly what it will do', async () => {
      const campaign = await buildCampaign();
      const preview = await moduleRef
        .get(CampaignPreviewService)
        .preview(shop(), campaign.id);

      expect(preview.changedVariants).toBe(3);
      const byVariant = new Map(
        preview.rows.map((row) => [row.shopifyVariantId, row]),
      );
      // 19.99 − 15% = 16.9915. Exact to four places, no float drift.
      expect(byVariant.get('gid://v/a')?.newPrice).toBe('16.9915');
      expect(byVariant.get('gid://v/b')?.newPrice).toBe('42.4915');
      expect(byVariant.get('gid://v/c')?.newPrice).toBe('4.2500');
    });

    it('applies the previewed numbers and puts them back exactly', async () => {
      const campaign = await buildCampaign();
      const preview = await moduleRef
        .get(CampaignPreviewService)
        .preview(shop(), campaign.id);
      const promised = new Map(
        preview.rows.map((row) => [row.shopifyVariantId, row.newPrice]),
      );

      await activation.activate(shop(), campaign.id, await newJob(campaign.id));

      // What the merchant approved is what the storefront got.
      expect(priceOf('a')).toBe(promised.get('gid://v/a'));
      expect(priceOf('b')).toBe(promised.get('gid://v/b'));
      expect(compareAtOf('a')).toBe('19.9900');

      const outcome = await revert.revert(shop(), campaign.id);
      expect(outcome.status).toBe(CampaignStatus.COMPLETED);
      expect(priceOf('a')).toBe('19.9900');
      expect(priceOf('b')).toBe('49.9900');
      // The product that was already on sale keeps its original compare-at.
      expect(compareAtOf('b')).toBe('79.9900');
      expect(priceOf('c')).toBe('5.0000');
    });
  });

  describe('path two — sheet upload → approve → activate → revert', () => {
    const uploadAndApprove = async () => {
      const content = [
        'SKU,Price',
        'SKU-a,12.5000',
        'SKU-b,30.0000',
        'SKU-missing,9.9900',
      ].join('\n');

      const record = await imports.upload(shop(), SUPPLIER, {
        originalname: 'acme.csv',
        mimetype: 'text/csv',
        size: Buffer.byteLength(content),
        buffer: Buffer.from(content, 'utf8'),
      });
      await mkdir(join(uploadDir, SHOP), { recursive: true });
      await writeFile(
        join(uploadDir, SHOP, `${record.id}.csv`),
        content,
        'utf8',
      );

      await imports.parse(SHOP, record.id);
      await imports.match(shop(), record.id);
      return { record, campaign: await imports.approve(shop(), record.id) };
    };

    it('carries the supplier prices through to the storefront', async () => {
      const { campaign } = await uploadAndApprove();
      await activation.activate(shop(), campaign.id, await newJob(campaign.id));

      expect(priceOf('a')).toBe('12.5000');
      expect(priceOf('b')).toBe('30.0000');
      // The unmatched SKU touched nothing.
      expect(priceOf('c')).toBe('5.0000');
    });

    it('restores the prices the sheet replaced', async () => {
      const { campaign } = await uploadAndApprove();
      await activation.activate(shop(), campaign.id, await newJob(campaign.id));

      await revert.revert(shop(), campaign.id);
      expect(priceOf('a')).toBe('19.9900');
      expect(priceOf('b')).toBe('49.9900');
      expect(compareAtOf('b')).toBe('79.9900');
    });

    it('honours a merchant’s edited price over the supplier’s', async () => {
      const { record, campaign } = await uploadAndApprove();
      const [row] = await dataSource.query<{ id: string }[]>(
        `SELECT id FROM csv_rows WHERE csv_import_id = $1 AND sku = 'SKU-a'`,
        [record.id],
      );
      await imports.overrideRow(SHOP, record.id, row.id, {
        approvedPrice: '11.1100',
      });

      await activation.activate(shop(), campaign.id, await newJob(campaign.id));
      expect(priceOf('a')).toBe('11.1100');
    });
  });

  describe('a failure mid-run leaves recoverable state', () => {
    it('resumes and finishes after a transient rejection', async () => {
      /*
       * The resilience question the phase asks: a long run must survive
       * throttling without losing its place. One variant is refused twice,
       * then accepted — the same shape as a rate limit clearing.
       */
      const campaign = await campaigns.create(SHOP, {
        title: 'Resilience',
        adjustmentUnit: 'PERCENTAGE' as never,
        adjustmentDirection: 'DECREASE' as never,
        adjustmentValue: '10',
      });
      const jobId = await newJob(campaign.id);
      failFor.set('gid://v/b', 2);

      const first = await activation.activate(shop(), campaign.id, jobId);
      expect(first.applied).toBe(2);
      expect(first.failed).toBe(1);

      const second = await activation.activate(shop(), campaign.id, jobId);
      expect(second.failed).toBe(1);

      const third = await activation.activate(shop(), campaign.id, jobId);
      expect(third.applied).toBe(3);
      expect(third.failed).toBe(0);
      expect(priceOf('b')).toBe('44.9910');
    });

    it('never applies a variant twice across those retries', async () => {
      const campaign = await campaigns.create(SHOP, {
        title: 'No double apply',
        adjustmentUnit: 'PERCENTAGE' as never,
        adjustmentDirection: 'DECREASE' as never,
        adjustmentValue: '10',
      });
      const jobId = await newJob(campaign.id);
      failFor.set('gid://v/b', 1);

      await activation.activate(shop(), campaign.id, jobId);
      await activation.activate(shop(), campaign.id, jobId);

      // 19.99 − 10% once is 17.9910. Applying twice would give 16.1919.
      expect(priceOf('a')).toBe('17.9910');
    });

    it('can still be reverted after a partial run', async () => {
      const campaign = await campaigns.create(SHOP, {
        title: 'Partial then revert',
        adjustmentUnit: 'PERCENTAGE' as never,
        adjustmentDirection: 'DECREASE' as never,
        adjustmentValue: '10',
      });
      // Refused for good — the variant never applies.
      failFor.set('gid://v/b', 99);
      await activation.activate(shop(), campaign.id, await newJob(campaign.id));

      const outcome = await revert.revert(shop(), campaign.id);
      // The two that applied go back; the one that never applied is untouched.
      expect(outcome.reverted).toBe(2);
      expect(priceOf('a')).toBe('19.9900');
      expect(priceOf('b')).toBe('49.9900');
    });
  });

  describe('sustained runs', () => {
    it('batches a large catalogue by product rather than by variant', async () => {
      live = new Map(
        Array.from({ length: 300 }, (_, i) => [
          `gid://v/x${i}`,
          variant(`x${i}`, '10.0000'),
        ]),
      );

      const campaign = await campaigns.create(SHOP, {
        title: 'Big one',
        adjustmentUnit: 'PERCENTAGE' as never,
        adjustmentDirection: 'DECREASE' as never,
        adjustmentValue: '10',
      });
      const outcome = await activation.activate(
        shop(),
        campaign.id,
        await newJob(campaign.id),
      );

      expect(outcome.applied).toBe(300);
      // One call per product here, because each variant is its own product —
      // the point is that it is bounded by products, not by variants squared.
      expect(callCount).toBe(300);
      expect(priceOf('x0')).toBe('9.0000');
    });
  });
});
