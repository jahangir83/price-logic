import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AppPlanHandle,
  BillingInterval,
  SubscriptionEventType,
  SubscriptionStatus,
} from '@pricelogic/shared';
import { Repository } from 'typeorm';
import { ShopifyAdminService } from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import { AppPlan } from '../entities/app-plan.entity';
import { StoreSubscriptionEvent } from '../entities/store-subscription-event.entity';
import { StoreSubscription } from '../entities/store-subscription.entity';

/**
 * Shopify's subscription statuses, mapped onto ours.
 *
 * Theirs is the authority — we never decide a merchant is paying, we only
 * record what Shopify tells us. `DECLINED` maps to CANCELLED rather than a
 * status of its own: from the app's point of view a declined charge and a
 * cancelled one are the same thing, which is no entitlement.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  ACTIVE: SubscriptionStatus.ACTIVE,
  PENDING: SubscriptionStatus.PENDING,
  ACCEPTED: SubscriptionStatus.ACTIVE,
  DECLINED: SubscriptionStatus.CANCELLED,
  CANCELLED: SubscriptionStatus.CANCELLED,
  EXPIRED: SubscriptionStatus.EXPIRED,
  FROZEN: SubscriptionStatus.FROZEN,
};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(AppPlan)
    private readonly plans: Repository<AppPlan>,
    @InjectRepository(StoreSubscription)
    private readonly subscriptions: Repository<StoreSubscription>,
    @InjectRepository(StoreSubscriptionEvent)
    private readonly events: Repository<StoreSubscriptionEvent>,
    private readonly shopify: ShopifyAdminService,
    private readonly config: ConfigService,
  ) {}

  async listPlans(): Promise<AppPlan[]> {
    return this.plans.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async current(shopId: string): Promise<StoreSubscription | null> {
    return this.subscriptions.findOne({ where: { shopId } });
  }

  /**
   * Start a charge and hand back Shopify's confirmation URL.
   *
   * The row is written **PENDING before the redirect**, so a merchant who
   * abandons the flow leaves a record rather than a mystery — and so the
   * webhook that arrives later has something to attach to.
   *
   * The Free plan needs no charge at all; subscribing to it is a downgrade
   * handled entirely on our side.
   */
  async subscribe(
    shop: Shop,
    handle: AppPlanHandle,
    interval: BillingInterval = BillingInterval.MONTHLY,
  ): Promise<{ confirmationUrl: string | null; plan: AppPlan }> {
    /*
     * Checked before the query, not after. An unknown handle otherwise reaches
     * Postgres and comes back as `invalid input value for enum` — a 500 that
     * tells the merchant nothing. The DTO validates this too; the service does
     * not rely on a DTO having run, because the webhook and admin paths call
     * it directly.
     */
    if (!Object.values(AppPlanHandle).includes(handle)) {
      throw new NotFoundException('That plan is not available.');
    }

    const plan = await this.plans.findOne({
      where: { handle, isActive: true },
    });
    if (!plan) throw new NotFoundException('That plan is not available.');

    const priceCents =
      interval === BillingInterval.ANNUAL
        ? (plan.annualPriceCents ?? plan.priceCents * 12)
        : plan.priceCents;

    if (priceCents === 0) {
      await this.downgradeToFree(shop, plan);
      return { confirmationUrl: null, plan };
    }

    const appUrl = this.config.get<string>('shopify.appUrl') ?? '';
    const created = await this.shopify.createSubscription(shop, {
      planName: plan.name,
      priceCents,
      interval:
        interval === BillingInterval.ANNUAL ? 'ANNUAL' : 'EVERY_30_DAYS',
      trialDays: plan.trialDays,
      returnUrl: `${appUrl}/billing/confirm?shop=${encodeURIComponent(shop.shopDomain)}`,
      currencyCode: shop.currency,
      // A development store must be able to accept a charge without anyone
      // being billed.
      test: this.config.get<string>('nodeEnv') !== 'production',
    });

    const existing = await this.current(shop.id);
    const fromPlanId = existing?.planId ?? null;

    await this.subscriptions.save(
      this.subscriptions.create({
        ...(existing ? { id: existing.id } : {}),
        shopId: shop.id,
        planId: plan.id,
        billingInterval: interval,
        shopifySubscriptionGid: created.subscriptionGid,
        status: SubscriptionStatus.PENDING,
        trialStartAt: plan.trialDays > 0 ? new Date() : null,
        trialEndAt:
          plan.trialDays > 0
            ? new Date(Date.now() + plan.trialDays * 86_400_000)
            : null,
        isInGracePeriod: false,
      }),
    );

    await this.recordEvent(shop.id, {
      type: SubscriptionEventType.SYNCED,
      fromPlanId,
      toPlanId: plan.id,
      payload: { confirmationRequested: true, interval },
    });

    return { confirmationUrl: created.confirmationUrl, plan };
  }

  /**
   * The merchant came back from Shopify's confirmation screen.
   *
   * **Re-reads from Shopify rather than trusting the redirect.** The merchant
   * lands here whether they accepted or declined, and a query parameter is not
   * a signature — treating the redirect as proof of payment is how an app
   * hands out entitlements it was never paid for.
   */
  async confirm(shop: Shop): Promise<StoreSubscription> {
    const subscription = await this.current(shop.id);
    if (!subscription?.shopifySubscriptionGid) {
      throw new BadRequestException(
        'There is no charge waiting to be confirmed.',
      );
    }

    const state = await this.shopify.fetchSubscription(
      shop,
      subscription.shopifySubscriptionGid,
    );
    if (!state) {
      // Shopify no longer knows about it — the merchant declined and it was
      // discarded. Treat that as a cancellation rather than leaving PENDING
      // forever.
      return this.applyStatus(shop.id, SubscriptionStatus.CANCELLED, {
        reason: 'Shopify no longer has this charge',
      });
    }

    return this.applyStatus(shop.id, mapStatus(state.status), {
      shopifyStatus: state.status,
      currentPeriodEnd: state.currentPeriodEnd,
      test: state.test,
    });
  }

  /**
   * `APP_SUBSCRIPTIONS_UPDATE` — the authoritative signal for everything after
   * confirmation: renewal, cancellation, a frozen card, expiry.
   */
  async handleWebhook(
    shopId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const subscription = (payload.app_subscription ?? {}) as Record<
      string,
      unknown
    >;
    // Narrowed rather than coerced: `String({})` on an unexpected payload
    // gives "[object Object]", which would then be mapped to a status.
    const shopifyStatus =
      typeof subscription.status === 'string' ? subscription.status : '';
    const gid =
      typeof subscription.admin_graphql_api_id === 'string'
        ? subscription.admin_graphql_api_id
        : '';

    if (!shopifyStatus) {
      this.logger.warn(
        `APP_SUBSCRIPTIONS_UPDATE for shop ${shopId} carried no status`,
      );
      return;
    }

    await this.applyStatus(shopId, mapStatus(shopifyStatus), {
      shopifyStatus,
      gid,
    });
  }

  /**
   * Write a status through, and record the transition.
   *
   * FROZEN turns the grace period on rather than removing entitlements —
   * Shopify freezes billing over a card that will retry, and dropping a
   * merchant mid-campaign would deactivate live sales over a temporary
   * payment problem. Any terminal status turns it off.
   */
  private async applyStatus(
    shopId: string,
    status: SubscriptionStatus,
    payload: Record<string, unknown>,
  ): Promise<StoreSubscription> {
    const subscription = await this.subscriptions.findOne({
      where: { shopId },
    });
    if (!subscription) {
      throw new NotFoundException('This shop has no subscription.');
    }

    const previous = subscription.status;
    subscription.status = status;
    subscription.isInGracePeriod = status === SubscriptionStatus.FROZEN;

    if (status === SubscriptionStatus.ACTIVE) {
      subscription.currentPeriodStartAt = new Date();
      const periodEnd = payload.currentPeriodEnd;
      subscription.currentPeriodEndAt =
        typeof periodEnd === 'string' ? new Date(periodEnd) : null;
    }

    const saved = await this.subscriptions.save(subscription);

    if (previous !== status) {
      await this.recordEvent(shopId, {
        type: eventTypeFor(previous, status),
        fromPlanId: saved.planId,
        toPlanId: saved.planId,
        payload: { ...payload, from: previous, to: status },
      });
      this.logger.log(`Shop ${shopId} subscription ${previous} → ${status}`);
    }

    return saved;
  }

  /**
   * Moving to Free needs no charge — and deliberately does **not** touch
   * running campaigns. The plan limit gates new activations only; deactivating
   * a live sale because a merchant downgraded would cost them money without
   * warning.
   */
  private async downgradeToFree(shop: Shop, freePlan: AppPlan): Promise<void> {
    const existing = await this.current(shop.id);
    const fromPlanId = existing?.planId ?? null;

    if (existing?.shopifySubscriptionGid) {
      const result = await this.shopify.cancelSubscription(
        shop,
        existing.shopifySubscriptionGid,
      );
      if (!result.cancelled && result.error) {
        // Not fatal: Shopify cancels the old charge itself when a new one
        // replaces it, and a stale charge is better than a failed downgrade.
        this.logger.warn(
          `Could not cancel the old charge for shop ${shop.id}: ${result.error}`,
        );
      }
    }

    await this.subscriptions.save(
      this.subscriptions.create({
        ...(existing ? { id: existing.id } : {}),
        shopId: shop.id,
        planId: freePlan.id,
        billingInterval: BillingInterval.MONTHLY,
        shopifySubscriptionGid: null,
        status: SubscriptionStatus.ACTIVE,
        isInGracePeriod: false,
        trialStartAt: null,
        trialEndAt: null,
      }),
    );

    await this.recordEvent(shop.id, {
      type: SubscriptionEventType.DOWNGRADED,
      fromPlanId,
      toPlanId: freePlan.id,
      payload: { toFree: true },
    });
  }

  /** Append-only. A billing dispute months later reads these, not the row. */
  private async recordEvent(
    shopId: string,
    input: {
      type: SubscriptionEventType;
      fromPlanId: string | null;
      toPlanId: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const subscription = await this.subscriptions.findOne({
      where: { shopId },
    });
    await this.events.insert({
      shopId,
      subscriptionId: subscription?.id ?? null,
      type: input.type,
      fromPlanId: input.fromPlanId,
      toPlanId: input.toPlanId,
      payload: input.payload as never,
    });
  }
}

function mapStatus(shopifyStatus: string): SubscriptionStatus {
  return STATUS_MAP[shopifyStatus.toUpperCase()] ?? SubscriptionStatus.PENDING;
}

/** Name the transition the way a person reading the trail would. */
function eventTypeFor(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): SubscriptionEventType {
  if (
    to === SubscriptionStatus.CANCELLED ||
    to === SubscriptionStatus.EXPIRED
  ) {
    return SubscriptionEventType.CANCELLED;
  }
  if (from === SubscriptionStatus.PENDING && to === SubscriptionStatus.ACTIVE) {
    return SubscriptionEventType.UPGRADED;
  }
  if (from === SubscriptionStatus.FROZEN && to === SubscriptionStatus.ACTIVE) {
    return SubscriptionEventType.RENEWED;
  }
  return SubscriptionEventType.SYNCED;
}
