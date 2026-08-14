import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AppPlanHandle,
  DuplicatePolicy,
  PLAN_LIMIT_EXCEEDED,
  SubscriptionStatus,
} from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { BillingService } from '../src/modules/billing/billing.service';
import { AppPlan } from '../src/modules/billing/entities/app-plan.entity';
import { StoreSubscriptionEvent } from '../src/modules/billing/entities/store-subscription-event.entity';
import { StoreSubscription } from '../src/modules/billing/entities/store-subscription.entity';
import { StoreUsage } from '../src/modules/billing/entities/store-usage.entity';
import { Campaign } from '../src/modules/campaigns/entities/campaign.entity';
import { CampaignTarget } from '../src/modules/campaigns/entities/campaign-target.entity';
import { PriceChange } from '../src/modules/campaigns/entities/price-change.entity';
import { ProductTagChange } from '../src/modules/campaigns/entities/product-tag-change.entity';
import { OverlapService } from '../src/modules/campaigns/overlap.service';
import { PermanentJobError } from '../src/modules/jobs/job-handler';

/**
 * Plan limits and campaign overlap against real PostgreSQL.
 *
 * The rules themselves are unit-tested in `@pricelogic/shared`. What is under
 * test here is the SQL that feeds them — which rows count as "on sale", how a
 * campaign's own history is excluded from its own quota check, and how two
 * campaigns wanting one variant are resolved. None of that survives being
 * mocked, and getting it wrong bills a merchant for products that are not
 * discounted.
 */
describe('plan limits and overlap', () => {
  let moduleRef: TestingModule;
  let billing: BillingService;
  let overlap: OverlapService;
  let dataSource: DataSource;

  const SHOP = '33333333-0000-4000-8000-000000000033';
  const CAMPAIGN_A = '44444444-0000-4000-8000-00000000004a';
  const CAMPAIGN_B = '44444444-0000-4000-8000-00000000004b';
  const JOB_A = '55555555-0000-4000-8000-00000000005a';
  const JOB_B = '55555555-0000-4000-8000-00000000005b';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [
            AppPlan,
            StoreSubscription,
            StoreSubscriptionEvent,
            StoreUsage,
            Campaign,
            CampaignTarget,
            PriceChange,
            ProductTagChange,
          ],
          synchronize: false,
        }),
      ],
      providers: [BillingService, OverlapService],
    }).compile();

    await moduleRef.init();
    billing = moduleRef.get(BillingService);
    overlap = moduleRef.get(OverlapService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  const cleanup = async () => {
    await dataSource.query(`DELETE FROM price_changes WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(`DELETE FROM store_usage WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(
      `DELETE FROM store_subscription_events WHERE shop_id = $1`,
      [SHOP],
    );
    await dataSource.query(
      `DELETE FROM store_subscriptions WHERE shop_id = $1`,
      [SHOP],
    );
    await dataSource.query(`DELETE FROM jobs WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
  };

  beforeEach(async () => {
    await cleanup();
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'lim', 'lim.myshopify.com', 'ciphertext')`,
      [SHOP],
    );
    await dataSource.query(
      `INSERT INTO campaigns (id, shop_id, title, status, start_at)
       VALUES ($1, $3, 'A', 'DRAFT', now() - interval '2 days'),
              ($2, $3, 'B', 'DRAFT', now() - interval '1 day')`,
      [CAMPAIGN_A, CAMPAIGN_B, SHOP],
    );
    await dataSource.query(
      `INSERT INTO jobs (id, shop_id, type, campaign_id)
       VALUES ($1, $3, 'CAMPAIGN_ACTIVATE', $4),
              ($2, $3, 'CAMPAIGN_ACTIVATE', $5)`,
      [JOB_A, JOB_B, SHOP, CAMPAIGN_A, CAMPAIGN_B],
    );
  });

  const activate = (campaignId: string) =>
    dataSource.query(`UPDATE campaigns SET status = 'ACTIVE' WHERE id = $1`, [
      campaignId,
    ]);

  const applyChange = (
    campaignId: string,
    jobId: string,
    variantId: string,
    newPrice: string,
    status = 'APPLIED',
    oldPrice = '100.0000',
  ) =>
    dataSource.query(
      `INSERT INTO price_changes
         (shop_id, campaign_id, job_id, shopify_product_id, shopify_variant_id,
          product_title, old_price, new_price, status)
       VALUES ($1, $2, $3, 'gid://p/1', $4, 'Tee', $6, $5, $7)`,
      [SHOP, campaignId, jobId, variantId, newPrice, oldPrice, status],
    );

  const setPlan = async (
    handle: AppPlanHandle,
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    isInGracePeriod = false,
  ) => {
    const [plan] = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM app_plans WHERE handle = $1`,
      [handle],
    );
    await dataSource.query(
      `INSERT INTO store_subscriptions (shop_id, plan_id, status, is_in_grace_period)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (shop_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         is_in_grace_period = EXCLUDED.is_in_grace_period`,
      [SHOP, plan.id, status, isInGracePeriod],
    );
  };

  describe('resolveLimits', () => {
    it('falls back to Free when the shop has no subscription', async () => {
      const limits = await billing.resolveLimits(SHOP);
      expect(limits.planHandle).toBe(AppPlanHandle.FREE);
      expect(limits.activeVariantLimit).toBe(50);
    });

    it('uses the subscribed plan', async () => {
      await setPlan(AppPlanHandle.PLUS);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(
        20000,
      );
    });

    it('treats Professional as unlimited', async () => {
      await setPlan(AppPlanHandle.PROFESSIONAL);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBeNull();
    });

    it('drops a cancelled subscription back to Free', async () => {
      await setPlan(AppPlanHandle.PLUS, SubscriptionStatus.CANCELLED);
      const limits = await billing.resolveLimits(SHOP);
      expect(limits.planHandle).toBe(AppPlanHandle.FREE);
    });

    it('keeps entitlements for a frozen subscription still in its grace period', async () => {
      // Shopify freezes billing over a card that will retry. Dropping the
      // merchant mid-campaign would deactivate live sales over that.
      await setPlan(AppPlanHandle.PLUS, SubscriptionStatus.FROZEN, true);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(
        20000,
      );
    });

    it('drops a frozen subscription once the grace period ends', async () => {
      await setPlan(AppPlanHandle.PLUS, SubscriptionStatus.FROZEN, false);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(50);
    });

    it('lets a shop override beat the plan', async () => {
      await setPlan(AppPlanHandle.FREE);
      await dataSource.query(
        `UPDATE shops SET override_active_variant_limit = 500 WHERE id = $1`,
        [SHOP],
      );
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(500);
    });
  });

  describe('computeUsage', () => {
    it('counts only applied changes on active campaigns', async () => {
      await activate(CAMPAIGN_A);
      await applyChange(CAMPAIGN_A, JOB_A, 'v1', '80.0000');
      // Never pushed to Shopify, so nothing is on sale.
      await applyChange(CAMPAIGN_A, JOB_A, 'v2', '80.0000', 'PENDING');
      // No longer on sale.
      await applyChange(CAMPAIGN_A, JOB_A, 'v3', '80.0000', 'REVERTED');
      // Belongs to a campaign that is not active.
      await applyChange(CAMPAIGN_B, JOB_B, 'v4', '80.0000');

      const usage = await billing.computeUsage(SHOP);
      expect(usage.activeVariantCount).toBe(1);
      expect(usage.activeCampaignCount).toBe(1);
    });

    it('counts a variant claimed by two campaigns once', async () => {
      await activate(CAMPAIGN_A);
      await activate(CAMPAIGN_B);
      await applyChange(CAMPAIGN_A, JOB_A, 'shared', '80.0000');
      await applyChange(CAMPAIGN_B, JOB_B, 'shared', '70.0000');

      expect((await billing.computeUsage(SHOP)).activeVariantCount).toBe(1);
    });

    it('reconciles the cached counters and stamps the time', async () => {
      await activate(CAMPAIGN_A);
      await applyChange(CAMPAIGN_A, JOB_A, 'v1', '80.0000');

      const usage = await billing.reconcileUsage(SHOP);
      expect(usage.activeVariantCount).toBe(1);
      expect(usage.lastReconciledAt).not.toBeNull();
    });

    it('creates a usage row on first read rather than returning nothing', async () => {
      const usage = await billing.getUsage(SHOP);
      expect(usage.activeVariantCount).toBe(0);
    });
  });

  describe('checkActivationQuota', () => {
    it('allows an activation that fits the Free plan', async () => {
      const variants = Array.from({ length: 40 }, (_, i) => `v${i}`);
      expect(
        (await billing.checkActivationQuota(SHOP, CAMPAIGN_A, variants))
          .allowed,
      ).toBe(true);
    });

    it('blocks the shop-wide total, not this campaign alone', async () => {
      // The hole a per-campaign check leaves: two 30-variant campaigns each
      // pass on their own and together break a 50-variant plan.
      await activate(CAMPAIGN_B);
      for (let i = 0; i < 30; i += 1) {
        await applyChange(CAMPAIGN_B, JOB_B, `b${i}`, '80.0000');
      }
      const mine = Array.from({ length: 30 }, (_, i) => `a${i}`);

      const result = await billing.checkActivationQuota(SHOP, CAMPAIGN_A, mine);
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('expected a violation');
      expect(result.violation.code).toBe(PLAN_LIMIT_EXCEEDED);
      expect(result.violation.current).toBe(30);
      expect(result.violation.required).toBe(60);
    });

    it('counts a variant two campaigns share only once', async () => {
      await setPlan(AppPlanHandle.STARTER);
      await activate(CAMPAIGN_B);
      for (let i = 0; i < 30; i += 1) {
        await applyChange(CAMPAIGN_B, JOB_B, `shared${i}`, '80.0000');
      }
      // The same 30 variants, so the shop-wide total stays 30 rather than 60.
      const mine = Array.from({ length: 30 }, (_, i) => `shared${i}`);
      const result = await billing.checkActivationQuota(SHOP, CAMPAIGN_A, mine);
      expect(result.allowed).toBe(true);

      // Assert the union directly: `allowed` alone would also pass if the
      // union were wrong but the plan happened to be large enough.
      const wider = await billing.checkActivationQuota(SHOP, CAMPAIGN_A, [
        ...mine,
        'extra',
      ]);
      expect(wider.allowed).toBe(true);
    });

    it('reports the deduplicated union as the required total', async () => {
      await setPlan(AppPlanHandle.FREE);
      await dataSource.query(
        `UPDATE shops SET override_active_campaign_limit = 10 WHERE id = $1`,
        [SHOP],
      );
      await activate(CAMPAIGN_B);
      for (let i = 0; i < 30; i += 1) {
        await applyChange(CAMPAIGN_B, JOB_B, `shared${i}`, '80.0000');
      }
      // 30 shared + 25 new = 55 distinct, over the Free plan's 50.
      const mine = [
        ...Array.from({ length: 30 }, (_, i) => `shared${i}`),
        ...Array.from({ length: 25 }, (_, i) => `new${i}`),
      ];
      const result = await billing.checkActivationQuota(SHOP, CAMPAIGN_A, mine);
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('expected a violation');
      expect(result.violation.dimension).toBe('VARIANTS');
      expect(result.violation.current).toBe(30);
      expect(result.violation.required).toBe(55);
    });

    it('does not count a campaign’s own rows against re-activating it', async () => {
      // Otherwise a merchant is locked out of a campaign that is already live.
      await activate(CAMPAIGN_A);
      for (let i = 0; i < 45; i += 1) {
        await applyChange(CAMPAIGN_A, JOB_A, `a${i}`, '80.0000');
      }
      const mine = Array.from({ length: 45 }, (_, i) => `a${i}`);
      const result = await billing.checkActivationQuota(SHOP, CAMPAIGN_A, mine);
      expect(result.allowed).toBe(true);
    });

    it('lets Professional through at a scale no other plan allows', async () => {
      await setPlan(AppPlanHandle.PROFESSIONAL);
      const variants = Array.from({ length: 5000 }, (_, i) => `v${i}`);
      expect(
        (await billing.checkActivationQuota(SHOP, CAMPAIGN_A, variants))
          .allowed,
      ).toBe(true);
    });

    it('enforces the campaign count once variants fit', async () => {
      // Free allows one active campaign.
      await activate(CAMPAIGN_B);
      const result = await billing.checkActivationQuota(SHOP, CAMPAIGN_A, [
        'v1',
      ]);
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('expected a violation');
      expect(result.violation.dimension).toBe('CAMPAIGNS');
    });
  });

  describe('enforceActivationQuota', () => {
    it('throws a permanent error the engine will not retry', async () => {
      await activate(CAMPAIGN_B);
      for (let i = 0; i < 60; i += 1) {
        await applyChange(CAMPAIGN_B, JOB_B, `b${i}`, '80.0000');
      }

      await expect(
        billing.enforceActivationQuota(SHOP, CAMPAIGN_A, ['x1']),
      ).rejects.toBeInstanceOf(PermanentJobError);

      await expect(
        billing.enforceActivationQuota(SHOP, CAMPAIGN_A, ['x1']),
      ).rejects.toMatchObject({ code: PLAN_LIMIT_EXCEEDED });
    });

    it('carries the numbers the upgrade prompt needs', async () => {
      await activate(CAMPAIGN_B);
      for (let i = 0; i < 60; i += 1) {
        await applyChange(CAMPAIGN_B, JOB_B, `b${i}`, '80.0000');
      }
      try {
        await billing.enforceActivationQuota(SHOP, CAMPAIGN_A, ['x1']);
        throw new Error('expected a rejection');
      } catch (error) {
        const permanent = error as PermanentJobError;
        expect(permanent.details).toMatchObject({
          dimension: 'VARIANTS',
          limit: 50,
          current: 60,
          required: 61,
        });
      }
    });

    it('passes silently when the activation fits', async () => {
      await expect(
        billing.enforceActivationQuota(SHOP, CAMPAIGN_A, ['v1', 'v2']),
      ).resolves.toBeUndefined();
    });
  });

  describe('overlap on apply', () => {
    beforeEach(async () => {
      await activate(CAMPAIGN_B);
      await applyChange(CAMPAIGN_B, JOB_B, 'contested', '80.0000');
    });

    it('leaves an uncontested variant alone', async () => {
      const [resolved] = await overlap.resolveForActivation(SHOP, CAMPAIGN_A, [
        {
          shopifyVariantId: 'free',
          newPrice: '90.0000',
          newCompareAtPrice: null,
        },
      ]);
      expect(resolved?.applies).toBe(true);
    });

    it('gives a contested variant to the bigger discount', async () => {
      const [resolved] = await overlap.resolveForActivation(SHOP, CAMPAIGN_A, [
        {
          shopifyVariantId: 'contested',
          newPrice: '70.0000',
          newCompareAtPrice: null,
        },
      ]);
      expect(resolved?.applies).toBe(true);
    });

    it('skips a contested variant when the rival discount is bigger', async () => {
      const [resolved] = await overlap.resolveForActivation(SHOP, CAMPAIGN_A, [
        {
          shopifyVariantId: 'contested',
          newPrice: '90.0000',
          newCompareAtPrice: null,
        },
      ]);
      expect(resolved?.applies).toBe(false);
      expect(resolved?.skipReason).toContain(CAMPAIGN_B);
    });

    it('honours a per-campaign policy override', async () => {
      await dataSource.query(
        `UPDATE campaigns SET duplicate_policy = $2 WHERE id = $1`,
        [CAMPAIGN_A, DuplicatePolicy.SKIP],
      );
      const [resolved] = await overlap.resolveForActivation(SHOP, CAMPAIGN_A, [
        {
          shopifyVariantId: 'contested',
          newPrice: '10.0000',
          newCompareAtPrice: null,
        },
      ]);
      // SKIP touches nothing contested, even with by far the better price.
      expect(resolved?.applies).toBe(false);
    });

    it('ignores a rival whose change was never applied', async () => {
      await dataSource.query(
        `UPDATE price_changes SET status = 'PENDING' WHERE campaign_id = $1`,
        [CAMPAIGN_B],
      );
      const [resolved] = await overlap.resolveForActivation(SHOP, CAMPAIGN_A, [
        {
          shopifyVariantId: 'contested',
          newPrice: '90.0000',
          newCompareAtPrice: null,
        },
      ]);
      expect(resolved?.applies).toBe(true);
    });
  });

  describe('overlap on revert', () => {
    it('restores the original price when nobody else holds the variant', async () => {
      await activate(CAMPAIGN_A);
      await applyChange(
        CAMPAIGN_A,
        JOB_A,
        'solo',
        '80.0000',
        'APPLIED',
        '100.0000',
      );

      const [target] = await overlap.resolveForRevert(SHOP, CAMPAIGN_A);
      expect(target?.price).toBe('100.0000');
      expect(target?.restoredOriginal).toBe(true);
    });

    it('does not un-discount a variant another live campaign still owns', async () => {
      /*
       * The bug blind reverting causes. A is 20% off, B is 30% off and holds
       * the variant. A ends — restoring A's stored 100.00 would put the
       * product back to full price while B is still advertising it on sale.
       */
      await activate(CAMPAIGN_A);
      await activate(CAMPAIGN_B);
      await applyChange(
        CAMPAIGN_A,
        JOB_A,
        'shared',
        '80.0000',
        'APPLIED',
        '100.0000',
      );
      await applyChange(CAMPAIGN_B, JOB_B, 'shared', '70.0000');

      const [target] = await overlap.resolveForRevert(SHOP, CAMPAIGN_A);
      expect(target?.price).toBe('70.0000');
      expect(target?.restoredOriginal).toBe(false);
    });

    it('ignores a rival campaign that is no longer active', async () => {
      await activate(CAMPAIGN_A);
      await applyChange(
        CAMPAIGN_A,
        JOB_A,
        'shared',
        '80.0000',
        'APPLIED',
        '100.0000',
      );
      // B holds a row but has finished, so it holds nothing on the storefront.
      await applyChange(CAMPAIGN_B, JOB_B, 'shared', '70.0000');

      const [target] = await overlap.resolveForRevert(SHOP, CAMPAIGN_A);
      expect(target?.price).toBe('100.0000');
      expect(target?.restoredOriginal).toBe(true);
    });

    it('returns nothing for a campaign that never applied anything', async () => {
      await applyChange(CAMPAIGN_A, JOB_A, 'v1', '80.0000', 'PENDING');
      expect(await overlap.resolveForRevert(SHOP, CAMPAIGN_A)).toEqual([]);
    });
  });
});
