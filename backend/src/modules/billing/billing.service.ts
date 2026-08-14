import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  AppPlanHandle,
  QuotaCheckResult,
  ResolvedPlanLimits,
  SubscriptionStatus,
  checkPlanQuota,
  resolvePlanLimits,
} from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { PermanentJobError } from '../jobs/job-handler';
import { AppPlan } from './entities/app-plan.entity';
import { StoreSubscription } from './entities/store-subscription.entity';
import { StoreUsage } from './entities/store-usage.entity';

export interface ShopUsageCounts {
  activeVariantCount: number;
  activeCampaignCount: number;
}

/**
 * Plan entitlements and the quota that gates activation.
 *
 * The arithmetic lives in `@pricelogic/shared` so the usage meter in the admin
 * UI and this check cannot disagree about what counts. What is here is the SQL
 * that feeds it — and the decision to recompute rather than trust the cached
 * counter, because a stale number here is a refund, not a slow page.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // -------------------------------------------------------------------
  // Entitlements
  // -------------------------------------------------------------------

  /**
   * The caps that actually apply to this shop.
   *
   * A shop with no subscription is on Free — never unlimited. A frozen
   * subscription inside its grace period keeps its entitlements, because
   * Shopify freezes billing over a card that will retry and dropping a
   * merchant mid-campaign would deactivate live sales over a temporary
   * payment problem.
   */
  async resolveLimits(shopId: string): Promise<ResolvedPlanLimits> {
    const subscription = await this.dataSource
      .getRepository(StoreSubscription)
      .findOne({ where: { shopId } });

    const entitled =
      subscription !== null &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.isInGracePeriod);

    const plan = entitled
      ? await this.dataSource
          .getRepository(AppPlan)
          .findOne({ where: { id: subscription.planId } })
      : null;

    const effectivePlan = plan ?? (await this.freePlan());

    const [overrides] = await this.dataSource.query<
      {
        override_active_variant_limit: number | null;
        override_active_campaign_limit: number | null;
      }[]
    >(
      `SELECT "override_active_variant_limit", "override_active_campaign_limit"
         FROM "shops" WHERE "id" = $1`,
      [shopId],
    );

    return resolvePlanLimits(effectivePlan, {
      activeVariantLimit: overrides?.override_active_variant_limit ?? null,
      activeCampaignLimit: overrides?.override_active_campaign_limit ?? null,
    });
  }

  private async freePlan(): Promise<AppPlan> {
    return this.dataSource
      .getRepository(AppPlan)
      .findOneOrFail({ where: { handle: AppPlanHandle.FREE } });
  }

  // -------------------------------------------------------------------
  // Usage
  // -------------------------------------------------------------------

  /**
   * What is on sale right now: distinct variants across *applied* changes
   * belonging to *active* campaigns.
   *
   * Both filters matter. A PENDING row was never pushed to Shopify, and a
   * REVERTED one is no longer on sale — counting either would bill a merchant
   * for products a customer cannot see discounted.
   */
  async computeUsage(shopId: string): Promise<ShopUsageCounts> {
    const [row] = await this.dataSource.query<
      { variants: string; campaigns: string }[]
    >(
      `
      SELECT
        (
          SELECT count(DISTINCT pc."shopify_variant_id")
            FROM "price_changes" pc
            JOIN "campaigns" c
              ON c."id" = pc."campaign_id" AND c."shop_id" = pc."shop_id"
           WHERE pc."shop_id" = $1
             AND pc."status" = 'APPLIED'
             AND c."status" = 'ACTIVE'
             AND c."deleted_at" IS NULL
        )::text AS variants,
        (
          SELECT count(*)
            FROM "campaigns" c
           WHERE c."shop_id" = $1
             AND c."status" = 'ACTIVE'
             AND c."deleted_at" IS NULL
        )::text AS campaigns
      `,
      [shopId],
    );

    return {
      activeVariantCount: Number(row?.variants ?? 0),
      activeCampaignCount: Number(row?.campaigns ?? 0),
    };
  }

  /** Refresh the cached counters the admin UI's meter reads. */
  async reconcileUsage(shopId: string): Promise<StoreUsage> {
    const counts = await this.computeUsage(shopId);
    await this.dataSource.query(
      `
      INSERT INTO "store_usage"
        ("shop_id", "active_variant_count", "active_campaign_count", "last_reconciled_at")
      VALUES ($1, $2, $3, now())
      ON CONFLICT ("shop_id") DO UPDATE SET
        "active_variant_count" = EXCLUDED."active_variant_count",
        "active_campaign_count" = EXCLUDED."active_campaign_count",
        "last_reconciled_at" = EXCLUDED."last_reconciled_at",
        "updated_at" = now()
      `,
      [shopId, counts.activeVariantCount, counts.activeCampaignCount],
    );

    return this.dataSource
      .getRepository(StoreUsage)
      .findOneOrFail({ where: { shopId } });
  }

  /**
   * Cached usage for display. Reconciles on first read so a shop that has
   * never activated anything still gets a row rather than a null meter.
   */
  async getUsage(shopId: string): Promise<StoreUsage> {
    const cached = await this.dataSource
      .getRepository(StoreUsage)
      .findOne({ where: { shopId } });
    return cached ?? this.reconcileUsage(shopId);
  }

  // -------------------------------------------------------------------
  // The quota gate
  // -------------------------------------------------------------------

  /**
   * Would this activation fit?
   *
   * Computes the shop-wide totals *after* the campaign proceeds, in one query,
   * so the union is deduplicated by the database rather than in memory —
   * `candidateVariantIds` can be tens of thousands of ids on a Plus plan.
   *
   * The campaign's own previously applied rows are excluded from `current`, so
   * re-activating a campaign that is already live does not count its variants
   * twice and lock the merchant out of their own campaign.
   */
  async checkActivationQuota(
    shopId: string,
    campaignId: string,
    candidateVariantIds: readonly string[],
  ): Promise<QuotaCheckResult> {
    const limits = await this.resolveLimits(shopId);

    const [row] = await this.dataSource.query<
      {
        current_variants: string;
        required_variants: string;
        current_campaigns: string;
        campaign_is_active: boolean;
      }[]
    >(
      `
      WITH existing AS (
        SELECT DISTINCT pc."shopify_variant_id" AS variant_id
          FROM "price_changes" pc
          JOIN "campaigns" c
            ON c."id" = pc."campaign_id" AND c."shop_id" = pc."shop_id"
         WHERE pc."shop_id" = $1
           AND pc."campaign_id" <> $2
           AND pc."status" = 'APPLIED'
           AND c."status" = 'ACTIVE'
           AND c."deleted_at" IS NULL
      ),
      candidate AS (
        SELECT DISTINCT unnest($3::text[]) AS variant_id
      )
      SELECT
        (SELECT count(*) FROM existing)::text AS current_variants,
        (
          SELECT count(*) FROM (
            SELECT variant_id FROM existing
            UNION
            SELECT variant_id FROM candidate
          ) merged
        )::text AS required_variants,
        (
          SELECT count(*) FROM "campaigns" c
           WHERE c."shop_id" = $1
             AND c."id" <> $2
             AND c."status" = 'ACTIVE'
             AND c."deleted_at" IS NULL
        )::text AS current_campaigns,
        EXISTS (
          SELECT 1 FROM "campaigns" c
           WHERE c."id" = $2 AND c."shop_id" = $1 AND c."status" = 'ACTIVE'
        ) AS campaign_is_active
      `,
      [shopId, campaignId, [...candidateVariantIds]],
    );

    const currentCampaigns = Number(row?.current_campaigns ?? 0);

    return checkPlanQuota({
      limits,
      currentActiveVariants: Number(row?.current_variants ?? 0),
      requiredActiveVariants: Number(row?.required_variants ?? 0),
      currentActiveCampaigns: currentCampaigns,
      // Re-activating an already-active campaign adds no campaign to the count.
      requiredActiveCampaigns: currentCampaigns + 1,
    });
  }

  /**
   * The gate itself, for use inside a job's CHECK_PLAN_LIMIT step.
   *
   * Throws `PermanentJobError`, which the engine never retries — the answer
   * will not change on its own, and burning the remaining attempts tells the
   * merchant nothing new. The violation's numbers travel with it so the UI can
   * render an upgrade prompt rather than a generic failure.
   */
  async enforceActivationQuota(
    shopId: string,
    campaignId: string,
    candidateVariantIds: readonly string[],
  ): Promise<void> {
    const result = await this.checkActivationQuota(
      shopId,
      campaignId,
      candidateVariantIds,
    );
    if (result.allowed) return;

    const { violation } = result;
    this.logger.warn(
      `Shop ${shopId} blocked at ${violation.required}/${violation.limit} ${violation.dimension.toLowerCase()}`,
    );
    throw new PermanentJobError(violation.message, violation.code, {
      dimension: violation.dimension,
      limit: violation.limit,
      current: violation.current,
      required: violation.required,
    });
  }
}
