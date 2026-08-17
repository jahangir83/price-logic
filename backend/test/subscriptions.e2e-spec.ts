import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AppPlanHandle,
  BillingInterval,
  SubscriptionEventType,
  SubscriptionStatus,
} from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { BillingService } from '../src/modules/billing/services/billing.service';
import { AppPlan } from '../src/modules/billing/entities/app-plan.entity';
import { StoreSubscriptionEvent } from '../src/modules/billing/entities/store-subscription-event.entity';
import { StoreSubscription } from '../src/modules/billing/entities/store-subscription.entity';
import { StoreUsage } from '../src/modules/billing/entities/store-usage.entity';
import { SubscriptionsService } from '../src/modules/billing/services/subscriptions.service';
import { Campaign } from '../src/modules/campaigns/entities/campaign.entity';
import { PriceChange } from '../src/modules/campaigns/entities/price-change.entity';
import { Job } from '../src/modules/jobs/entities/job.entity';
import { ShopifyAdminService } from '../src/modules/shopify/services/shopify-admin.service';
import { Shop } from '../src/modules/shops/entities/shop.entity';

/**
 * Billing against a scripted Shopify.
 *
 * The rule under test throughout: **we never decide a merchant is paying.**
 * Every entitlement change traces back to something Shopify said — the
 * confirmation query or the update webhook — and never to a redirect the
 * merchant's browser made.
 */
describe('Shopify billing', () => {
  let moduleRef: TestingModule;
  let subscriptions: SubscriptionsService;
  let billing: BillingService;
  let dataSource: DataSource;

  const SHOP = '55556666-0000-4000-8000-000055556666';
  const CAMPAIGN = '77778888-0000-4000-8000-000077778888';

  /** What Shopify will say the subscription's status is. */
  let shopifyStatus: string;
  let subscriptionExists: boolean;
  let created: { planName: string; priceCents: number; trialDays: number }[];
  let cancelled: string[];

  const shopifyStub = {
    createSubscription: (
      _shop: Shop,
      input: { planName: string; priceCents: number; trialDays: number },
    ) => {
      created.push(input);
      return Promise.resolve({
        subscriptionGid: 'gid://shopify/AppSubscription/1',
        confirmationUrl: 'https://shop.myshopify.com/confirm/1',
      });
    },
    fetchSubscription: () =>
      Promise.resolve(
        subscriptionExists
          ? {
              subscriptionGid: 'gid://shopify/AppSubscription/1',
              status: shopifyStatus,
              name: 'Plus',
              test: true,
              trialDays: 3,
              currentPeriodEnd: '2026-09-14T00:00:00Z',
              createdAt: '2026-08-15T00:00:00Z',
            }
          : null,
      ),
    cancelSubscription: (_shop: Shop, gid: string) => {
      cancelled.push(gid);
      return Promise.resolve({ cancelled: true, error: null });
    },
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [
            Shop,
            AppPlan,
            StoreSubscription,
            StoreSubscriptionEvent,
            StoreUsage,
            Campaign,
            PriceChange,
            Job,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          AppPlan,
          StoreSubscription,
          StoreSubscriptionEvent,
        ]),
      ],
      providers: [
        SubscriptionsService,
        BillingService,
        { provide: ShopifyAdminService, useValue: shopifyStub },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'shopify.appUrl'
                ? 'https://app.example.com'
                : key === 'nodeEnv'
                  ? 'test'
                  : undefined,
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    subscriptions = moduleRef.get(SubscriptionsService);
    billing = moduleRef.get(BillingService);
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
    await dataSource.query(`DELETE FROM jobs WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id = $1`, [SHOP]);
    await dataSource.query(
      `DELETE FROM store_subscription_events WHERE shop_id = $1`,
      [SHOP],
    );
    await dataSource.query(
      `DELETE FROM store_subscriptions WHERE shop_id = $1`,
      [SHOP],
    );
    await dataSource.query(`DELETE FROM store_usage WHERE shop_id = $1`, [
      SHOP,
    ]);
    await dataSource.query(`DELETE FROM shops WHERE id = $1`, [SHOP]);
  };

  const shop = () =>
    ({
      id: SHOP,
      shopDomain: 'bill.myshopify.com',
      currency: 'USD',
    }) as Shop;

  beforeEach(async () => {
    await cleanup();
    shopifyStatus = 'ACTIVE';
    subscriptionExists = true;
    created = [];
    cancelled = [];

    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'bill', 'bill.myshopify.com', 'x')`,
      [SHOP],
    );
  });

  const statusOf = async (): Promise<string> => {
    const [row] = await dataSource.query<{ status: string }[]>(
      `SELECT status FROM store_subscriptions WHERE shop_id = $1`,
      [SHOP],
    );
    return row?.status ?? 'NONE';
  };

  const eventTypes = async (): Promise<string[]> => {
    const rows = await dataSource.query<{ type: string }[]>(
      `SELECT type FROM store_subscription_events WHERE shop_id = $1
        ORDER BY occurred_at ASC`,
      [SHOP],
    );
    return rows.map((row) => row.type);
  };

  describe('starting a charge', () => {
    it('returns Shopify’s confirmation URL', async () => {
      const result = await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
      expect(result.confirmationUrl).toBe(
        'https://shop.myshopify.com/confirm/1',
      );
    });

    it('sends the plan’s price and trial to Shopify', async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
      expect(created[0]).toMatchObject({ priceCents: 1299, trialDays: 3 });
    });

    it('uses the annual price when asked', async () => {
      await subscriptions.subscribe(
        shop(),
        AppPlanHandle.PLUS,
        BillingInterval.ANNUAL,
      );
      expect(created[0]?.priceCents).toBe(12470);
    });

    it('records the row as PENDING before the merchant sees the screen', async () => {
      // A merchant who abandons the flow leaves a record rather than a
      // mystery, and the webhook that arrives later has something to attach to.
      await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
      expect(await statusOf()).toBe(SubscriptionStatus.PENDING);
    });

    it('grants nothing until Shopify confirms', async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
      // Still Free: a pending charge is not a paid one.
      const limits = await billing.resolveLimits(SHOP);
      expect(limits.planHandle).toBe(AppPlanHandle.FREE);
      expect(limits.activeVariantLimit).toBe(50);
    });

    it('needs no charge for the Free plan', async () => {
      const result = await subscriptions.subscribe(shop(), AppPlanHandle.FREE);
      expect(result.confirmationUrl).toBeNull();
      expect(created).toHaveLength(0);
      expect(await statusOf()).toBe(SubscriptionStatus.ACTIVE);
    });
  });

  describe('the confirmation return', () => {
    beforeEach(async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
    });

    it('grants the plan when Shopify says it was accepted', async () => {
      shopifyStatus = 'ACTIVE';
      await subscriptions.confirm(shop());

      expect(await statusOf()).toBe(SubscriptionStatus.ACTIVE);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(
        20000,
      );
    });

    it('grants nothing when the merchant declined', async () => {
      // They land on the same return URL either way — the redirect is not
      // proof of payment, which is why the status is re-read.
      shopifyStatus = 'DECLINED';
      await subscriptions.confirm(shop());

      expect(await statusOf()).toBe(SubscriptionStatus.CANCELLED);
      expect((await billing.resolveLimits(SHOP)).planHandle).toBe(
        AppPlanHandle.FREE,
      );
    });

    it('treats a charge Shopify has forgotten as cancelled', async () => {
      subscriptionExists = false;
      await subscriptions.confirm(shop());
      expect(await statusOf()).toBe(SubscriptionStatus.CANCELLED);
    });

    it('records the transition', async () => {
      shopifyStatus = 'ACTIVE';
      await subscriptions.confirm(shop());
      expect(await eventTypes()).toContain(SubscriptionEventType.UPGRADED);
    });
  });

  describe('the update webhook', () => {
    beforeEach(async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
      shopifyStatus = 'ACTIVE';
      await subscriptions.confirm(shop());
    });

    const send = (status: string) =>
      subscriptions.handleWebhook(SHOP, {
        app_subscription: {
          status,
          admin_graphql_api_id: 'gid://shopify/AppSubscription/1',
        },
      });

    it('freezes without removing entitlements', async () => {
      // Shopify freezes over a card that will retry. Dropping the merchant
      // mid-campaign would deactivate live sales over a temporary problem.
      await send('FROZEN');

      expect(await statusOf()).toBe(SubscriptionStatus.FROZEN);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(
        20000,
      );
    });

    it('removes entitlements once the grace period ends', async () => {
      await send('FROZEN');
      await send('CANCELLED');
      expect((await billing.resolveLimits(SHOP)).planHandle).toBe(
        AppPlanHandle.FREE,
      );
    });

    it('restores entitlements when the card clears', async () => {
      await send('FROZEN');
      await send('ACTIVE');

      const [row] = await dataSource.query<{ is_in_grace_period: boolean }[]>(
        `SELECT is_in_grace_period FROM store_subscriptions WHERE shop_id = $1`,
        [SHOP],
      );
      expect(row?.is_in_grace_period).toBe(false);
      expect(await eventTypes()).toContain(SubscriptionEventType.RENEWED);
    });

    it('handles expiry', async () => {
      await send('EXPIRED');
      expect(await statusOf()).toBe(SubscriptionStatus.EXPIRED);
      expect((await billing.resolveLimits(SHOP)).planHandle).toBe(
        AppPlanHandle.FREE,
      );
    });

    it('ignores a payload with no status rather than corrupting the row', async () => {
      await subscriptions.handleWebhook(SHOP, { app_subscription: {} });
      expect(await statusOf()).toBe(SubscriptionStatus.ACTIVE);
    });

    it('records every transition, append-only', async () => {
      await send('FROZEN');
      await send('ACTIVE');
      await send('CANCELLED');

      const types = await eventTypes();
      // Requested, confirmed, frozen, renewed, cancelled.
      expect(types.length).toBeGreaterThanOrEqual(5);
      expect(types).toContain(SubscriptionEventType.CANCELLED);
    });
  });

  describe('downgrading', () => {
    beforeEach(async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.PLUS);
      shopifyStatus = 'ACTIVE';
      await subscriptions.confirm(shop());
    });

    it('cancels the old charge', async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.FREE);
      expect(cancelled).toContain('gid://shopify/AppSubscription/1');
    });

    it('leaves a running campaign alone', async () => {
      /*
       * The limit gates new activations only. Deactivating a live sale because
       * a merchant downgraded would cost them money without warning.
       */
      await dataSource.query(
        `INSERT INTO campaigns (id, shop_id, title, status)
         VALUES ($1, $2, 'Live sale', 'ACTIVE')`,
        [CAMPAIGN, SHOP],
      );

      await subscriptions.subscribe(shop(), AppPlanHandle.FREE);

      const [row] = await dataSource.query<{ status: string }[]>(
        `SELECT status FROM campaigns WHERE id = $1`,
        [CAMPAIGN],
      );
      expect(row?.status).toBe('ACTIVE');
    });

    it('records it as a downgrade', async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.FREE);
      expect(await eventTypes()).toContain(SubscriptionEventType.DOWNGRADED);
    });

    it('applies the smaller limit to the next activation', async () => {
      await subscriptions.subscribe(shop(), AppPlanHandle.FREE);
      expect((await billing.resolveLimits(SHOP)).activeVariantLimit).toBe(50);
    });
  });

  describe('plans', () => {
    it('lists the four in order', async () => {
      const plans = await subscriptions.listPlans();
      expect(plans.map((plan) => plan.handle)).toEqual([
        AppPlanHandle.FREE,
        AppPlanHandle.STARTER,
        AppPlanHandle.PLUS,
        AppPlanHandle.PROFESSIONAL,
      ]);
    });

    it('refuses a plan that does not exist', async () => {
      await expect(
        subscriptions.subscribe(shop(), 'GOLD' as AppPlanHandle),
      ).rejects.toThrow(/not available/);
    });
  });
});
