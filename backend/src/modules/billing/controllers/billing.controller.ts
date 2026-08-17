import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  AppPlanHandle,
  BillingInterval,
  resolvePlanLimits,
  type AppPlanDto,
  type ResolvedPlanLimits,
  type StoreSubscriptionDto,
  type StoreUsageDto,
} from '@pricelogic/shared';
import { IsEnum, IsOptional } from 'class-validator';
import { SessionAuthGuard } from '../../../common/auth/session-auth.guard';
import { ShopGuard } from '../../../common/auth/shop.guard';
import { Shop } from '../../shops/entities/shop.entity';
import { BillingService } from '../services/billing.service';
import { SubscriptionsService } from '../services/subscriptions.service';

interface RequestWithShop {
  shop: Shop;
}

export class SubscribeDto {
  @IsEnum(AppPlanHandle)
  plan!: AppPlanHandle;

  @IsOptional()
  @IsEnum(BillingInterval)
  interval?: BillingInterval;
}

/** Everything the pricing page needs, in one call. */
export interface BillingOverviewResponse {
  plans: AppPlanDto[];
  subscription: StoreSubscriptionDto | null;
  currentPlanHandle: AppPlanHandle;
  limits: ResolvedPlanLimits;
  usage: StoreUsageDto;
}

@Controller('billing')
@UseGuards(SessionAuthGuard, ShopGuard)
export class BillingController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly billing: BillingService,
  ) {}

  /**
   * The plans, the current one, and how much of it the shop is using.
   *
   * One call rather than three, because the pricing page cannot render any of
   * it usefully in isolation — "20,000 variants" means nothing without "you
   * are using 1,450".
   */
  @Get('overview')
  async overview(
    @Req() request: RequestWithShop,
  ): Promise<BillingOverviewResponse> {
    const shop = request.shop;

    const [plans, subscription, limits, usage] = await Promise.all([
      this.subscriptions.listPlans(),
      this.subscriptions.current(shop.id),
      this.billing.resolveLimits(shop.id),
      this.billing.getUsage(shop.id),
    ]);

    const currentPlan = subscription
      ? plans.find((plan) => plan.id === subscription.planId)
      : undefined;

    return {
      plans: plans as unknown as AppPlanDto[],
      subscription: subscription as unknown as StoreSubscriptionDto | null,
      // Falls back to Free rather than undefined: a shop with no subscription
      // is on Free, and the page should say so plainly.
      currentPlanHandle: currentPlan?.handle ?? AppPlanHandle.FREE,
      limits,
      usage: usage as unknown as StoreUsageDto,
    };
  }

  /**
   * Start a plan change.
   *
   * Returns Shopify's confirmation URL for a paid plan — the merchant has to
   * accept the charge on Shopify's own screen, and nothing is billed until
   * they do. Moving to Free needs no charge, so `confirmationUrl` is null and
   * the change is already done.
   */
  @Post('subscribe')
  async subscribe(
    @Req() request: RequestWithShop,
    @Body() dto: SubscribeDto,
  ): Promise<{ confirmationUrl: string | null; plan: AppPlanDto }> {
    const result = await this.subscriptions.subscribe(
      request.shop,
      dto.plan,
      dto.interval ?? BillingInterval.MONTHLY,
    );
    return {
      confirmationUrl: result.confirmationUrl,
      plan: result.plan as unknown as AppPlanDto,
    };
  }

  /**
   * Where Shopify sends the merchant back after they accept or decline.
   *
   * The status is re-read from Shopify rather than taken from the redirect —
   * they land here either way, and a query parameter is not proof of payment.
   */
  @Get('confirm')
  async confirm(
    @Req() request: RequestWithShop,
  ): Promise<{ status: string; limits: ResolvedPlanLimits }> {
    const subscription = await this.subscriptions.confirm(request.shop);
    return {
      status: subscription.status,
      limits: await this.billing.resolveLimits(request.shop.id),
    };
  }
}

export { resolvePlanLimits };
