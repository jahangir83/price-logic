import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_STORE_SETTINGS,
  calculatePrice,
  compare,
  describeOutcome,
  resolveBasePrice,
  resolveStoreSettings,
  shouldApply,
  stockSkipReason,
  toCampaignAdjustment,
  type CampaignPreviewResponse,
  type CampaignPreviewRow,
  type Money,
  type PriceCalculationResult,
  type StoreSettings,
} from '@pricelogic/shared';
import {
  ShopifyAdminService,
  type CatalogVariant,
} from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import { CampaignsService } from './campaigns.service';
import { CampaignTargetsService } from './campaign-targets.service';
import { Campaign } from '../entities/campaign.entity';
import { TargetResolverService } from './target-resolver.service';

/** What a preview computed, before it is paginated for display. */
export interface CampaignPricing {
  campaign: Campaign;
  rows: PricedVariant[];
  truncated: boolean;
  excludedVariantCount: number;
}

export interface PricedVariant {
  variant: CatalogVariant;
  result: PriceCalculationResult;
  applies: boolean;
  note: string | null;
}

/**
 * Works out what a campaign would do, without doing it.
 *
 * **Persists nothing.** No `price_changes` row is written here — a preview the
 * merchant never approves must leave no trace, and Phase 6 recomputes from the
 * campaign configuration rather than reading anything this produced.
 *
 * That recomputation is the constitution's rule in practice: the preview
 * response is display-only, and the only inputs to a real price are the
 * campaign row and what Shopify says the variant costs at the moment of
 * writing. Nothing a client sends can reach the applied price, because no
 * endpoint accepts a price at all.
 */
@Injectable()
export class CampaignPreviewService {
  private readonly logger = new Logger(CampaignPreviewService.name);

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly targets: CampaignTargetsService,
    private readonly resolver: TargetResolverService,
    private readonly shopify: ShopifyAdminService,
  ) {}

  /**
   * Resolve targets, read live prices and run the calculator.
   *
   * Shared by the preview endpoint and (in Phase 6) by activation, so the two
   * cannot disagree about what a campaign covers — the preview a merchant
   * approves is produced by the same code path that applies it.
   */
  async price(shop: Shop, campaignId: string): Promise<CampaignPricing> {
    const campaign = await this.campaigns.findOne(shop.id, campaignId);
    const targetRows = await this.targets.list(shop.id, campaignId);

    const resolved = await this.resolver.resolve(shop, {
      includeMode: campaign.includeMode,
      excludeDraftArchived: campaign.excludeDraftArchived,
      exclusionsEnabled: campaign.exclusionsEnabled,
      targets: targetRows.map((row) => ({
        mode: row.mode,
        targetType: row.targetType,
        targetValue: row.targetValue,
      })),
    });

    const adjustment = toCampaignAdjustment(campaign);

    /*
     * The shop's price floor. Read here rather than inside `priceOne` so every
     * row in one preview is judged against the same number — a setting that
     * changed mid-loop would produce a preview no single state of the shop
     * could have generated.
     */
    const settings = resolveStoreSettings(shop.defaultSettings);
    const { minimumPrice } = settings;

    const rows = resolved.variants.map((variant) =>
      this.priceOne(campaign, variant, adjustment, minimumPrice, settings),
    );

    return {
      campaign,
      rows,
      truncated: resolved.truncated,
      excludedVariantCount: resolved.excludedVariantCount,
    };
  }

  private priceOne(
    campaign: Campaign,
    variant: CatalogVariant,
    adjustment: ReturnType<typeof toCampaignAdjustment>,
    minPrice: Money,
    settings: Pick<StoreSettings, 'skipOutOfStock'>,
  ): PricedVariant {
    /*
     * Out of stock is decided before anything is calculated, because the answer
     * is the same whatever the price would have been: there is no point
     * repricing something nobody can buy, and a campaign that promotes it is
     * worse than one that does not.
     */
    const outOfStock = stockSkipReason(
      { shop: variant.inventoryQuantity },
      settings,
    );
    if (outOfStock) {
      return {
        variant,
        result: {
          newPrice: variant.price,
          newCompareAtPrice: variant.compareAtPrice,
          outcome: 'UNCHANGED',
          changed: false,
          warnings: [],
        },
        applies: false,
        note: 'Out of stock, so this variant is left alone.',
      };
    }

    const basePrice = resolveBasePrice({
      priceSource: campaign.priceSource,
      basis: campaign.basis,
      currentPrice: variant.price,
      currentCompareAtPrice: variant.compareAtPrice,
    });

    if (basePrice === null) {
      // Compare-at basis on a variant that has no compare-at. Skipping is the
      // honest answer — there is no number to discount from.
      return {
        variant,
        result: {
          newPrice: variant.price,
          newCompareAtPrice: variant.compareAtPrice,
          outcome: 'UNCHANGED',
          changed: false,
          warnings: [],
        },
        applies: false,
        note: 'This variant has no compare-at price to calculate from.',
      };
    }

    const result = calculatePrice({
      currentPrice: variant.price,
      currentCompareAtPrice: variant.compareAtPrice,
      basePrice,
      adjustment,
      roundTo: campaign.roundTo,
      roundStrategy: campaign.roundStrategy,
      setCompareAt: campaign.setCompareAt,
      minPrice,
    });

    return {
      variant,
      result,
      applies: shouldApply(result),
      note: describeOutcome(result, {
        // Above the built-in 0.01 guard means the merchant raised it, and only
        // then is "below your minimum price" a thing they can act on. At the
        // default it would send someone hunting for a bug in their discount.
        hasMerchantFloor:
          compare(minPrice, DEFAULT_STORE_SETTINGS.minimumPrice) > 0,
      }),
    };
  }

  /** The paginated, display-shaped response the admin UI renders. */
  async preview(
    shop: Shop,
    campaignId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<CampaignPreviewResponse> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(
      Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      250,
    );

    const pricing = await this.price(shop, campaignId);

    // Rows that will change are shown first: the merchant is approving a
    // change, and paging through unchanged rows to find it is not a review.
    const ordered = [...pricing.rows].sort(
      (a, b) => Number(b.applies) - Number(a.applies),
    );
    const slice = ordered.slice((page - 1) * pageSize, page * pageSize);

    const changed = pricing.rows.filter((row) => row.applies);
    const taggedProducts = campaignTouchesTags(pricing.campaign)
      ? new Set(changed.map((row) => row.variant.productId)).size
      : 0;

    return {
      campaignId,
      totalVariants: pricing.rows.length,
      changedVariants: changed.length,
      taggedProducts,
      rows: slice.map((row) => toPreviewRow(row, shop.currency)),
      // A campaign resolving to zero variants is a valid empty preview, not an
      // error — "nothing matched" is information the merchant needs.
      truncated: pricing.truncated,
    };
  }
}

function toPreviewRow(
  row: PricedVariant,
  currency: string,
): CampaignPreviewRow {
  return {
    shopifyProductId: row.variant.productId,
    shopifyVariantId: row.variant.variantId,
    productTitle: row.variant.productTitle,
    variantTitle: row.variant.variantTitle,
    sku: row.variant.sku,
    currentPrice: row.variant.price,
    currentCompareAtPrice: row.variant.compareAtPrice,
    newPrice: row.result.newPrice,
    newCompareAtPrice: row.result.newCompareAtPrice,
    currency,
    changed: row.applies,
    note: row.note,
  };
}

/** Why a row will not be applied, in words a merchant can act on. */

function campaignTouchesTags(campaign: Campaign): boolean {
  return campaign.addTags.length > 0 || campaign.removeTags.length > 0;
}
