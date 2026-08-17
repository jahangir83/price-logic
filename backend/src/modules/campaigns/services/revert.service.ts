import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CampaignStatus,
  PriceChangeStatus,
  ProductTagChangeStatus,
  equals,
  type Money,
} from '@pricelogic/shared';
import { In, Repository } from 'typeorm';
import { BillingService } from '../../billing/services/billing.service';
import { ShopifyAdminService } from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import { CampaignsService } from './campaigns.service';
import { Campaign } from '../entities/campaign.entity';
import { PriceChange } from '../entities/price-change.entity';
import { ProductTagChange } from '../entities/product-tag-change.entity';
import { OverlapService } from './overlap.service';

export interface RevertProgress {
  total: number;
  reverted: number;
  skipped: number;
  failed: number;
}

export interface RevertOutcome extends RevertProgress {
  campaignId: string;
  status: CampaignStatus;
  tagsReverted: number;
}

/** What one variant should go back to, and the rows that say so. */
interface RevertPlan {
  shopifyProductId: string;
  shopifyVariantId: string;
  /** Every applied row for this variant, oldest first. */
  rows: PriceChange[];
  restorePrice: Money;
  restoreCompareAtPrice: Money | null;
  /** What we last set it to — used to detect a manual edit since. */
  expectedPrice: Money;
  /** Set when another live campaign now owns the variant. */
  ownedByOtherCampaign: boolean;
}

/**
 * Putting prices and tags back.
 *
 * Reads a record of what was done and replays it. No recalculation, no history
 * table, no lookup of what the campaign was configured to do — `price_changes`
 * already carries `old_price` and `old_compare_at_price`, and restoring
 * **both** is what lets a product that was already on sale get its earlier
 * sale price back rather than its full price.
 *
 * The same path serves a scheduled end and a merchant ending a sale early.
 * The only difference is what triggered it.
 */
@Injectable()
export class RevertService {
  private readonly logger = new Logger(RevertService.name);

  constructor(
    @InjectRepository(PriceChange)
    private readonly priceChanges: Repository<PriceChange>,
    @InjectRepository(ProductTagChange)
    private readonly tagChanges: Repository<ProductTagChange>,
    private readonly campaignsService: CampaignsService,
    private readonly overlap: OverlapService,
    private readonly billing: BillingService,
    private readonly shopify: ShopifyAdminService,
  ) {}

  /**
   * Work out what each variant goes back to.
   *
   * **The oldest applied row wins.** If a campaign was activated twice without
   * a revert in between — 100 → 80, then 80 → 70 — the second row's
   * `old_price` is 80, which this campaign set. Restoring that would leave its
   * own effect half in place. The first row's 100 is the price the campaign
   * found, and that is what "put it back" means.
   */
  private async plan(shop: Shop, campaign: Campaign): Promise<RevertPlan[]> {
    const applied = await this.priceChanges.find({
      where: {
        shopId: shop.id,
        campaignId: campaign.id,
        status: PriceChangeStatus.APPLIED,
      },
      order: { createdAt: 'ASC' },
    });
    if (applied.length === 0) return [];

    const byVariant = new Map<string, PriceChange[]>();
    for (const row of applied) {
      const bucket = byVariant.get(row.shopifyVariantId);
      if (bucket) bucket.push(row);
      else byVariant.set(row.shopifyVariantId, [row]);
    }

    // Where another active campaign still holds the variant, its price wins
    // over the stored original — ending campaign A must not un-discount a
    // product campaign B is still advertising.
    const survivors = await this.overlap.resolveForRevert(shop.id, campaign.id);
    const owned = new Map(
      survivors
        .filter((target) => !target.restoredOriginal)
        .map((target) => [target.shopifyVariantId, target]),
    );

    return [...byVariant.entries()].map(([variantId, rows]) => {
      const oldest = rows[0];
      const newest = rows[rows.length - 1];
      const survivor = owned.get(variantId);

      return {
        shopifyProductId: oldest.shopifyProductId,
        shopifyVariantId: variantId,
        rows,
        restorePrice: survivor?.price ?? oldest.oldPrice,
        restoreCompareAtPrice:
          survivor?.compareAtPrice ?? oldest.oldCompareAtPrice,
        expectedPrice: newest.newPrice,
        ownedByOtherCampaign: survivor !== undefined,
      };
    });
  }

  /**
   * Revert a campaign. Safe to call again — a completed revert is a no-op.
   *
   * Resumable for the same reason activation is: only `APPLIED` rows are
   * touched, so an interrupted run picks up exactly what it did not finish.
   */
  async revert(
    shop: Shop,
    campaignId: string,
    hooks: {
      onProgress?: (progress: RevertProgress) => Promise<void>;
      shouldStop?: () => Promise<boolean>;
    } = {},
  ): Promise<RevertOutcome> {
    const campaign = await this.campaignsService.findOne(shop.id, campaignId);
    const plans = await this.plan(shop, campaign);

    const progress: RevertProgress = {
      total: plans.length,
      reverted: 0,
      skipped: 0,
      failed: 0,
    };

    // Live prices, to spot anything edited since we set it.
    const live = await this.shopify.fetchVariantPrices(
      shop,
      plans.map((plan) => plan.shopifyVariantId),
    );
    const livePrices = new Map(
      live.map((record) => [record.variantId, record.price]),
    );

    const byProduct = new Map<string, RevertPlan[]>();
    for (const plan of plans) {
      const bucket = byProduct.get(plan.shopifyProductId);
      if (bucket) bucket.push(plan);
      else byProduct.set(plan.shopifyProductId, [plan]);
    }

    for (const [productId, productPlans] of byProduct) {
      if (hooks.shouldStop && (await hooks.shouldStop())) {
        this.logger.log(`Revert of campaign ${campaignId} stopping on request`);
        break;
      }

      const toWrite: RevertPlan[] = [];

      for (const plan of productPlans) {
        const livePrice = livePrices.get(plan.shopifyVariantId);

        /*
         * Somebody changed this price after we did — the merchant in the
         * Shopify admin, or another app. Overwriting a deliberate manual
         * change is worse than leaving it alone, so the row is SKIPPED with a
         * reason and surfaced in the results rather than silently clobbered.
         *
         * A variant that has vanished from Shopify is skipped for the same
         * reason: there is nothing to put back.
         */
        if (livePrice === undefined) {
          await this.close(
            plan.rows,
            PriceChangeStatus.SKIPPED,
            'This variant no longer exists in Shopify.',
          );
          progress.skipped += 1;
          continue;
        }
        if (!equals(livePrice, plan.expectedPrice)) {
          await this.close(
            plan.rows,
            PriceChangeStatus.SKIPPED,
            `The price was changed to ${livePrice} after this campaign set it, so it was left alone.`,
          );
          progress.skipped += 1;
          continue;
        }

        toWrite.push(plan);
      }

      if (toWrite.length === 0) continue;

      const outcomes = await this.shopify.updateVariantPrices(
        shop,
        productId,
        toWrite.map((plan) => ({
          variantId: plan.shopifyVariantId,
          price: plan.restorePrice,
          compareAtPrice: plan.restoreCompareAtPrice,
        })),
      );
      const byVariant = new Map(
        outcomes.map((outcome) => [outcome.variantId, outcome]),
      );

      for (const plan of toWrite) {
        const outcome = byVariant.get(plan.shopifyVariantId);
        if (outcome?.applied) {
          await this.close(plan.rows, PriceChangeStatus.REVERTED, null);
          progress.reverted += 1;
        } else {
          // Left APPLIED on purpose: the price is still ours, so a retry has
          // to try again rather than treat it as finished.
          await this.priceChanges.update(
            { id: plan.rows[plan.rows.length - 1].id },
            {
              errorMessage:
                outcome?.error ?? 'Shopify did not respond for this variant.',
            },
          );
          progress.failed += 1;
        }
      }

      if (hooks.onProgress) await hooks.onProgress(progress);
    }

    const tagsReverted = await this.revertTags(shop, campaign);

    return this.finalise(shop, campaign, progress, tagsReverted);
  }

  /** Mark every row for a variant, so a re-run does not see it as outstanding. */
  private async close(
    rows: PriceChange[],
    status: PriceChangeStatus,
    errorMessage: string | null,
  ): Promise<void> {
    await this.priceChanges.update(
      { id: In(rows.map((row) => row.id)) },
      { status, errorMessage, revertedAt: new Date() },
    );
  }

  /**
   * Put tags back exactly as they were.
   *
   * Only rows we wrote exist — activation records nothing when a product
   * already carried a tag the campaign wanted to add — so a tag the merchant
   * added themselves during the sale is never stripped. That property comes
   * entirely from what was *not* written, which is why the record is the
   * source rather than the campaign's configuration.
   */
  private async revertTags(shop: Shop, campaign: Campaign): Promise<number> {
    const applied = await this.tagChanges.find({
      where: {
        shopId: shop.id,
        campaignId: campaign.id,
        status: ProductTagChangeStatus.APPLIED,
      },
    });

    let reverted = 0;
    for (const row of applied) {
      const result = await this.shopify.updateProductTags(
        shop,
        row.shopifyProductId,
        row.oldTags,
      );

      if (result.applied) {
        row.status = ProductTagChangeStatus.REVERTED;
        row.revertedAt = new Date();
        row.errorMessage = null;
        reverted += 1;
      } else {
        row.errorMessage = result.error;
      }
      await this.tagChanges.save(row);
    }
    return reverted;
  }

  /**
   * A revert that put everything back completes the campaign. One that could
   * not finish stays ACTIVE, because prices are still ours and the merchant
   * needs to be able to try again — marking it COMPLETED would hide live
   * discounts behind a campaign that claims to be over.
   */
  private async finalise(
    shop: Shop,
    campaign: Campaign,
    progress: RevertProgress,
    tagsReverted: number,
  ): Promise<RevertOutcome> {
    const outstanding = await this.priceChanges.count({
      where: {
        shopId: shop.id,
        campaignId: campaign.id,
        status: PriceChangeStatus.APPLIED,
      },
    });

    const status =
      outstanding === 0 ? CampaignStatus.COMPLETED : CampaignStatus.ACTIVE;

    if (status === CampaignStatus.COMPLETED) {
      await this.campaignsService.changeStatus(shop.id, campaign.id, status);
    }
    await this.billing.reconcileUsage(shop.id);
    this.shopify.invalidate(shop.id);

    if (progress.failed > 0) {
      this.logger.warn(
        `Campaign ${campaign.id}: ${progress.failed} variant(s) could not be reverted`,
      );
    }

    return { campaignId: campaign.id, status, tagsReverted, ...progress };
  }
}
