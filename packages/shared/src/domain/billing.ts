import type { Serialized } from '../serialization.js';

export enum AppPlanHandle {
  FREE = 'FREE',
  STARTER = 'STARTER',
  PLUS = 'PLUS',
  PROFESSIONAL = 'PROFESSIONAL',
}

export enum BillingInterval {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  /** Charge created, merchant has not confirmed it in Shopify yet. */
  PENDING = 'PENDING',
  CANCELLED = 'CANCELLED',
  /** Shopify froze the shop's billing — treat as no paid entitlement. */
  FROZEN = 'FROZEN',
  EXPIRED = 'EXPIRED',
}

export enum SubscriptionEventType {
  SYNCED = 'SYNCED',
  UPGRADED = 'UPGRADED',
  DOWNGRADED = 'DOWNGRADED',
  CANCELLED = 'CANCELLED',
  RENEWED = 'RENEWED',
}

/**
 * A plan and its caps.
 *
 * Lives in the database rather than in code because prices and caps change for
 * commercial reasons, and a per-shop override — an enterprise deal, a support
 * gesture, a grandfathered merchant — cannot be a constant. This package owns
 * the handle enum; the numbers come from the table.
 *
 * A null limit means unlimited.
 */
export interface AppPlan {
  id: string;
  handle: AppPlanHandle;
  name: string;
  priceCents: number;
  annualPriceCents: number | null;
  trialDays: number;
  /** Variants that may be on sale at once. Null = unlimited. */
  activeVariantLimit: number | null;
  /** Campaigns that may be active at once. Null = unlimited. */
  activeCampaignLimit: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AppPlanDto = Serialized<AppPlan>;

export interface StoreSubscription {
  id: string;
  shopId: string;
  planId: string;
  billingInterval: BillingInterval;
  /** Shopify's `AppSubscription` GID — null until the charge is created. */
  shopifySubscriptionGid: string | null;
  status: SubscriptionStatus;
  currentPeriodStartAt: Date | null;
  currentPeriodEndAt: Date | null;
  trialStartAt: Date | null;
  trialEndAt: Date | null;
  isInGracePeriod: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type StoreSubscriptionDto = Serialized<StoreSubscription>;

/**
 * Append-only billing history.
 *
 * Merchants dispute charges, and the current subscription row cannot answer
 * "what plan was I on when this was billed?". Rows are never updated.
 */
export interface StoreSubscriptionEvent {
  id: string;
  shopId: string;
  subscriptionId: string | null;
  type: SubscriptionEventType;
  fromPlanId: string | null;
  toPlanId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export type StoreSubscriptionEventDto = Serialized<StoreSubscriptionEvent>;

/**
 * Cached usage, for the meter in the UI.
 *
 * Deliberately *not* the enforcement source: a denormalized counter always
 * drifts, which is what `lastReconciledAt` is admitting. The quota check at
 * activation recomputes from `price_changes` instead — it runs once per
 * activation, already holds the shop's concurrency lock, and is gating revenue.
 */
export interface StoreUsage {
  shopId: string;
  activeVariantCount: number;
  activeCampaignCount: number;
  lastReconciledAt: Date | null;
  updatedAt: Date;
}

export type StoreUsageDto = Serialized<StoreUsage>;

/**
 * The caps that actually apply to a shop, after overrides.
 *
 * Resolved rather than read directly from the plan, because a shop-level
 * override column (null = "use the plan default") takes precedence.
 */
export interface ResolvedPlanLimits {
  planHandle: AppPlanHandle;
  activeVariantLimit: number | null;
  activeCampaignLimit: number | null;
}

export function resolvePlanLimits(
  plan: Pick<
    AppPlan,
    'handle' | 'activeVariantLimit' | 'activeCampaignLimit'
  >,
  overrides: {
    activeVariantLimit?: number | null;
    activeCampaignLimit?: number | null;
  } = {},
): ResolvedPlanLimits {
  return {
    planHandle: plan.handle,
    activeVariantLimit:
      overrides.activeVariantLimit ?? plan.activeVariantLimit,
    activeCampaignLimit:
      overrides.activeCampaignLimit ?? plan.activeCampaignLimit,
  };
}
