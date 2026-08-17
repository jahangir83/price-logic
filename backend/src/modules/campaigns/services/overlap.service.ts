import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DuplicatePolicy,
  Money,
  VariantClaim,
  effectiveDuplicatePolicy,
  resolveAfterRelease,
  resolveOverlap,
} from '@pricelogic/shared';
import { DataSource } from 'typeorm';

/** One price this campaign wants to set, before overlap is considered. */
export interface ProposedChange {
  shopifyVariantId: string;
  newPrice: Money;
  newCompareAtPrice: Money | null;
}

/** A proposed change, after overlap has been resolved. */
export interface ResolvedChange extends ProposedChange {
  /** False when another campaign's claim won and this one must be skipped. */
  applies: boolean;
  /** Populated when `applies` is false, for the results screen. */
  skipReason: string | null;
}

/** What to write back to Shopify for one variant when a campaign ends. */
export interface RevertTarget {
  shopifyVariantId: string;
  shopifyProductId: string;
  price: Money;
  compareAtPrice: Money | null;
  /**
   * False when another active campaign still holds the variant, so this is
   * that campaign's price rather than the price from before we touched it.
   */
  restoredOriginal: boolean;
}

interface ClaimRow {
  shopify_variant_id: string;
  campaign_id: string;
  job_id: string;
  new_price: string;
  new_compare_at_price: string | null;
  activated_at: Date | null;
}

/**
 * Two active campaigns wanting the same variant.
 *
 * The decision rules are pure and live in `@pricelogic/shared`; this service
 * supplies them with the claims that actually exist in the database, on both
 * sides of a campaign's life:
 *
 * - **on apply**, which campaign's price a contested variant gets;
 * - **on revert**, what a variant becomes when one campaign lets go while
 *   another still holds it — the half that blindly restoring `old_price`
 *   gets wrong, by un-discounting a product a live campaign is advertising.
 */
@Injectable()
export class OverlapService {
  private readonly logger = new Logger(OverlapService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * The policy in force for a campaign: its own override if set, otherwise the
   * shop's global setting.
   */
  async policyFor(
    shopId: string,
    campaignId: string,
  ): Promise<DuplicatePolicy> {
    const [row] = await this.dataSource.query<
      {
        shop_policy: DuplicatePolicy;
        campaign_policy: DuplicatePolicy | null;
      }[]
    >(
      `
      SELECT s."duplicate_policy" AS shop_policy,
             c."duplicate_policy" AS campaign_policy
        FROM "shops" s
        LEFT JOIN "campaigns" c ON c."id" = $2 AND c."shop_id" = s."id"
       WHERE s."id" = $1
      `,
      [shopId, campaignId],
    );

    return effectiveDuplicatePolicy(
      row?.shop_policy ?? null,
      row?.campaign_policy ?? null,
    );
  }

  /**
   * Claims held on these variants by *other* active campaigns.
   *
   * Only APPLIED rows count: a PENDING change was never pushed, so it holds
   * nothing on the storefront and must not displace a campaign that did.
   */
  private async claimsByVariant(
    shopId: string,
    variantIds: readonly string[],
    excludeCampaignId: string,
  ): Promise<Map<string, VariantClaim[]>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    const rows = await this.dataSource.query<ClaimRow[]>(
      `
      SELECT pc."shopify_variant_id",
             pc."campaign_id",
             pc."job_id",
             pc."new_price",
             pc."new_compare_at_price",
             c."start_at" AS activated_at
        FROM "price_changes" pc
        JOIN "campaigns" c
          ON c."id" = pc."campaign_id" AND c."shop_id" = pc."shop_id"
       WHERE pc."shop_id" = $1
         AND pc."campaign_id" <> $2
         AND pc."status" = 'APPLIED'
         AND c."status" = 'ACTIVE'
         AND c."deleted_at" IS NULL
         AND pc."shopify_variant_id" = ANY($3::text[])
      `,
      [shopId, excludeCampaignId, [...variantIds]],
    );

    const byVariant = new Map<string, VariantClaim[]>();
    for (const row of rows) {
      const claim: VariantClaim = {
        campaignId: row.campaign_id,
        jobId: row.job_id,
        newPrice: row.new_price,
        newCompareAtPrice: row.new_compare_at_price,
        activatedAt: row.activated_at,
      };
      const existing = byVariant.get(row.shopify_variant_id);
      if (existing) {
        existing.push(claim);
      } else {
        byVariant.set(row.shopify_variant_id, [claim]);
      }
    }
    return byVariant;
  }

  /**
   * Decide which proposed changes actually apply.
   *
   * A displaced change is returned with `applies: false` rather than dropped,
   * so the caller can write it as SKIPPED and the results screen can tell the
   * merchant *why* a product they expected was left alone.
   */
  async resolveForActivation(
    shopId: string,
    campaignId: string,
    proposed: readonly ProposedChange[],
    activatedAt: Date | null = new Date(),
  ): Promise<ResolvedChange[]> {
    const policy = await this.policyFor(shopId, campaignId);
    const others = await this.claimsByVariant(
      shopId,
      proposed.map((change) => change.shopifyVariantId),
      campaignId,
    );

    let contested = 0;

    const resolved = proposed.map((change) => {
      const rivals = others.get(change.shopifyVariantId) ?? [];
      if (rivals.length === 0) {
        return { ...change, applies: true, skipReason: null };
      }

      contested += 1;
      const mine: VariantClaim = {
        campaignId,
        jobId: '',
        newPrice: change.newPrice,
        newCompareAtPrice: change.newCompareAtPrice,
        activatedAt,
      };
      const { winner } = resolveOverlap([...rivals, mine], policy);

      if (winner?.campaignId === campaignId) {
        return { ...change, applies: true, skipReason: null };
      }
      return {
        ...change,
        applies: false,
        skipReason:
          winner === null
            ? 'Another campaign also targets this variant'
            : `Campaign ${winner.campaignId} has a better claim on this variant`,
      };
    });

    if (contested > 0) {
      this.logger.log(
        `Campaign ${campaignId}: ${contested} contested variant(s) resolved by ${policy}`,
      );
    }
    return resolved;
  }

  /**
   * What to write back for each variant when this campaign ends.
   *
   * Not simply `old_price`. Campaign A (20% off) is active, B (30% off)
   * overwrites the price, then A ends — restoring A's stored original would
   * put the variant back to full price while B is still advertising it as on
   * sale. So each variant is re-resolved against whoever still holds it, and
   * the original is restored only when nobody does.
   */
  async resolveForRevert(
    shopId: string,
    campaignId: string,
  ): Promise<RevertTarget[]> {
    const policy = await this.policyFor(shopId, campaignId);

    const applied = await this.dataSource.query<
      {
        shopify_variant_id: string;
        shopify_product_id: string;
        old_price: string;
        old_compare_at_price: string | null;
      }[]
    >(
      `
      SELECT pc."shopify_variant_id",
             pc."shopify_product_id",
             pc."old_price",
             pc."old_compare_at_price"
        FROM "price_changes" pc
       WHERE pc."shop_id" = $1
         AND pc."campaign_id" = $2
         AND pc."status" = 'APPLIED'
      `,
      [shopId, campaignId],
    );

    const survivors = await this.claimsByVariant(
      shopId,
      applied.map((row) => row.shopify_variant_id),
      campaignId,
    );

    return applied.map((row) => {
      const remaining = survivors.get(row.shopify_variant_id) ?? [];
      const outcome = resolveAfterRelease(
        remaining,
        row.old_price,
        row.old_compare_at_price,
        policy,
      );
      return {
        shopifyVariantId: row.shopify_variant_id,
        shopifyProductId: row.shopify_product_id,
        price: outcome.price,
        compareAtPrice: outcome.compareAtPrice,
        restoredOriginal: outcome.restoredOriginal,
      };
    });
  }
}
