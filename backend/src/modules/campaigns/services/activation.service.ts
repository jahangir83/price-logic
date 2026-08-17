import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BulkOperationStatus,
  CampaignPriceSource,
  CampaignStatus,
  CsvRowStatus,
  PriceChangeStatus,
  ProductTagChangeStatus,
  DEFAULT_STORE_SETTINGS,
  StockSkipReason,
  SYNC_ITEMS_PER_REQUEST,
  calculatePrice,
  compare,
  describeOutcome,
  isTerminalBulkOperationStatus,
  resolveStoreSettings,
  stockSkipReason,
  resolveTagChange,
  shouldApply,
  toCampaignAdjustment,
  type Money,
} from '@pricelogic/shared';
import { DataSource, In, Repository } from 'typeorm';
import { BillingService } from '../../billing/services/billing.service';
import { CsvRow } from '../../imports/entities/csv-row.entity';
import { JobsService } from '../../jobs/services/jobs.service';
import { BulkOperationService } from '../../shopify/services/bulk-operation.service';
import { ShopifyAdminService } from '../../shopify/services/shopify-admin.service';
import { Shop } from '../../shops/entities/shop.entity';
import {
  BULK_VARIANT_PRICE_MUTATION,
  chunkForBulkMutation,
  interpretBulkResults,
  shouldUseBulkOperation,
  type BulkMutationResultLine,
} from '../bulk-price-writer';
import { CampaignsService } from './campaigns.service';
import { CampaignPreviewService } from './preview.service';
import { Campaign } from '../entities/campaign.entity';
import { PriceChange } from '../entities/price-change.entity';
import { ProductTagChange } from '../entities/product-tag-change.entity';
import { OverlapService } from './overlap.service';

/** Counts a caller can show as a progress bar rather than a spinner. */
export interface ActivationProgress {
  total: number;
  applied: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface ActivationOutcome extends ActivationProgress {
  campaignId: string;
  status: CampaignStatus;
  /**
   * Set when the run parked on a Shopify bulk operation rather than finishing.
   *
   * The campaign is not activated yet and the job must not be completed — it
   * resumes when the operation does.
   */
  waitingForBulk?: boolean;
}

/**
 * What the job engine lends to an activation run.
 *
 * All optional, so the service stays callable — and testable — without a job.
 * The bulk path simply is not available when there is nothing to park.
 */
export interface ActivationHooks {
  onProgress?: (progress: ActivationProgress) => Promise<void>;
  shouldStop?: () => Promise<boolean>;
  /** Record what this step produced, for the next run to read. */
  recordStep?: (result: Record<string, unknown>) => Promise<void>;
  /** Park the job on a bulk operation and stop. */
  waitForBulk?: (bulkOperationId: string) => Promise<void>;
}

/** One variant's intended change, before anything is written. */
interface PlannedChange {
  shopifyProductId: string;
  shopifyVariantId: string;
  productTitle: string;
  variantTitle: string | null;
  oldPrice: Money;
  oldCompareAtPrice: Money | null;
  newPrice: Money;
  newCompareAtPrice: Money | null;
  apply: boolean;
  note: string | null;
}

/**
 * Products handled between progress reports on the synchronous path.
 *
 * The same figure as the reference implementation's per-request limit, and the
 * unit is products rather than variants because `productVariantsBulkUpdate`
 * takes one product's variants per call.
 */
const PRODUCTS_PER_PASS = SYNC_ITEMS_PER_REQUEST;

/**
 * Applying a campaign to Shopify.
 *
 * **The Shopify write cannot join a database transaction.** Everything here is
 * shaped by that: rows are written PENDING *before* the external call, each
 * variant's outcome is recorded individually, and partial failure is the
 * normal case rather than an exception. A crash between the write and the call
 * leaves a recoverable record; the alternative leaves an untracked mutation on
 * a live storefront.
 *
 * Idempotency is per **execution**, not per campaign. `price_changes` is unique
 * on `(job_id, shopify_variant_id)`, so a retry of the same job cannot
 * double-apply a variant, while a genuine re-activation is a new job and writes
 * fresh rows — which is what preserves the price the first run would need to
 * restore.
 */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaigns: Repository<Campaign>,
    @InjectRepository(PriceChange)
    private readonly priceChanges: Repository<PriceChange>,
    @InjectRepository(ProductTagChange)
    private readonly tagChanges: Repository<ProductTagChange>,
    @InjectRepository(CsvRow)
    private readonly csvRows: Repository<CsvRow>,
    private readonly campaignsService: CampaignsService,
    private readonly preview: CampaignPreviewService,
    private readonly overlap: OverlapService,
    private readonly billing: BillingService,
    private readonly shopify: ShopifyAdminService,
    private readonly bulkOperations: BulkOperationService,
    private readonly jobs: JobsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Refuse to start a campaign that should not be started.
   *
   * Called before the job is even enqueued, so a merchant gets an immediate
   * answer rather than a job that fails a second later.
   */
  async assertActivatable(shop: Shop, campaignId: string): Promise<Campaign> {
    const campaign = await this.campaignsService.findOne(shop.id, campaignId);

    if (campaign.status === CampaignStatus.ACTIVE) {
      throw new ConflictException('This campaign is already running.');
    }
    if (
      campaign.status === CampaignStatus.COMPLETED ||
      campaign.status === CampaignStatus.CANCELLED
    ) {
      throw new ConflictException(
        `A ${campaign.status.toLowerCase()} campaign cannot be started again. Duplicate it instead.`,
      );
    }
    return campaign;
  }

  // -------------------------------------------------------------------
  // Planning
  // -------------------------------------------------------------------

  /**
   * Work out every intended change, reading prices **now**.
   *
   * Never from cache and never from the preview: a scheduled campaign may have
   * been previewed days ago, and `old_price` has to be what the price actually
   * was at the moment we changed it, or revert restores a number that was
   * never on the storefront.
   */
  private async plan(shop: Shop, campaign: Campaign): Promise<PlannedChange[]> {
    return campaign.priceSource === CampaignPriceSource.SHEET
      ? this.planFromSheet(shop, campaign)
      : this.planFromCatalog(shop, campaign);
  }

  private async planFromCatalog(
    shop: Shop,
    campaign: Campaign,
  ): Promise<PlannedChange[]> {
    // The same code path the preview uses, so what the merchant approved and
    // what runs cannot disagree about scope or arithmetic.
    const pricing = await this.preview.price(shop, campaign.id);

    const resolved = await this.overlap.resolveForActivation(
      shop.id,
      campaign.id,
      pricing.rows
        .filter((row) => row.applies)
        .map((row) => ({
          shopifyVariantId: row.variant.variantId,
          newPrice: row.result.newPrice,
          newCompareAtPrice: row.result.newCompareAtPrice,
        })),
    );
    const decisions = new Map(
      resolved.map((row) => [row.shopifyVariantId, row]),
    );

    return pricing.rows.map((row) => {
      const decision = decisions.get(row.variant.variantId);
      const blockedByOverlap = decision !== undefined && !decision.applies;

      return {
        shopifyProductId: row.variant.productId,
        shopifyVariantId: row.variant.variantId,
        productTitle: row.variant.productTitle,
        variantTitle: row.variant.variantTitle,
        oldPrice: row.variant.price,
        oldCompareAtPrice: row.variant.compareAtPrice,
        newPrice: row.result.newPrice,
        newCompareAtPrice: row.result.newCompareAtPrice,
        apply: row.applies && !blockedByOverlap,
        note: blockedByOverlap ? decision.skipReason : row.note,
      };
    });
  }

  /**
   * A sheet campaign prices from the approved rows, not from targeting.
   *
   * `csv_rows.current_price` is deliberately *not* reused as `old_price` — it
   * was captured when the sheet was matched, possibly days before approval.
   * The live price is re-read here for exactly that reason.
   */
  private async planFromSheet(
    shop: Shop,
    campaign: Campaign,
  ): Promise<PlannedChange[]> {
    if (!campaign.csvImportId) return [];

    const rows = await this.csvRows.find({
      where: {
        shopId: shop.id,
        csvImportId: campaign.csvImportId,
        status: CsvRowStatus.MATCHED,
        excluded: false,
      },
    });
    if (rows.length === 0) return [];

    const live = await this.shopify.fetchVariantPrices(
      shop,
      rows
        .map((row) => row.shopifyVariantId)
        .filter((id): id is string => Boolean(id)),
    );
    const byVariant = new Map(live.map((record) => [record.variantId, record]));
    const adjustment = toCampaignAdjustment(campaign);
    const settings = resolveStoreSettings(shop.defaultSettings);
    const { minimumPrice } = settings;

    const planned: PlannedChange[] = [];
    for (const row of rows) {
      const variant = row.shopifyVariantId
        ? byVariant.get(row.shopifyVariantId)
        : undefined;

      // Deleted between matching and activation. Nothing to price.
      if (!variant || !row.sheetPrice) continue;

      /*
       * Stock is judged on what Shopify says *now*, not on `row.stockQuantity`
       * — that was read when the sheet was matched, possibly days before the
       * merchant approved it, and stock is the fastest-moving thing on the row.
       * The live figure arrives on the same call that re-reads prices, for the
       * same reason.
       *
       * The supplier's own count has no live equivalent, so the sheet's figure
       * stands: it is the only statement they made.
       */
      const outOfStock = stockSkipReason(
        { supplier: row.sheetStock, shop: variant.inventoryQuantity },
        settings,
      );
      if (outOfStock) {
        planned.push({
          shopifyProductId: variant.productId,
          shopifyVariantId: variant.variantId,
          productTitle: variant.productTitle,
          variantTitle: variant.variantTitle,
          oldPrice: variant.price,
          oldCompareAtPrice: variant.compareAtPrice,
          newPrice: variant.price,
          newCompareAtPrice: variant.compareAtPrice,
          apply: false,
          note:
            outOfStock === StockSkipReason.SUPPLIER
              ? 'The supplier has none of this, so it is left alone.'
              : 'Out of stock, so this variant is left alone.',
        });
        continue;
      }

      /*
       * A merchant's edited `approved_price` wins over the calculator — that
       * edit is the whole point of the approval screen. Where they left it
       * alone, the sheet price goes through the campaign's own adjustment, so
       * "supplier list plus my markup" works.
       */
      const result = calculatePrice({
        currentPrice: variant.price,
        currentCompareAtPrice: variant.compareAtPrice,
        basePrice: row.approvedPrice ?? row.sheetPrice,
        adjustment: row.approvedPrice ? null : adjustment,
        roundTo: row.approvedPrice ? null : campaign.roundTo,
        roundStrategy: campaign.roundStrategy,
        setCompareAt: campaign.setCompareAt,
        // The floor applies to an approved sheet price too. A merchant
        // approving a supplier's list has agreed to those prices as an input,
        // not waived the protection they set against them.
        minPrice: minimumPrice,
      });

      planned.push({
        shopifyProductId: variant.productId,
        shopifyVariantId: variant.variantId,
        productTitle: variant.productTitle,
        variantTitle: variant.variantTitle,
        oldPrice: variant.price,
        oldCompareAtPrice: variant.compareAtPrice,
        newPrice: result.newPrice,
        newCompareAtPrice: result.newCompareAtPrice,
        apply: shouldApply(result),
        // Was hardcoded to 'Already at this price.', which recorded every
        // skipped row as unchanged — including the ones skipped because the
        // price was floored, which is the opposite of nothing happening.
        note: describeOutcome(result, {
          hasMerchantFloor:
            compare(minimumPrice, DEFAULT_STORE_SETTINGS.minimumPrice) > 0,
        }),
      });
    }
    return planned;
  }

  // -------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------

  /**
   * Apply a campaign. Safe to call again on the same job.
   *
   * @param onProgress called after each product so a caller can report counts
   */
  async activate(
    shop: Shop,
    campaignId: string,
    jobId: string,
    hooks: ActivationHooks = {},
  ): Promise<ActivationOutcome> {
    const campaign = await this.campaignsService.findOne(shop.id, campaignId);

    const existing = await this.priceChanges.count({ where: { jobId } });
    if (existing === 0) {
      const planned = await this.plan(shop, campaign);

      // The quota gate, before the first mutation and before any child work.
      await this.billing.enforceActivationQuota(
        shop.id,
        campaignId,
        planned.filter((change) => change.apply).map((c) => c.shopifyVariantId),
      );

      await this.writePlan(shop, campaign, jobId, planned);
    } else {
      // A retry: the plan is already on disk. Re-planning would re-read
      // Shopify and could produce a *different* old_price than the rows that
      // were already applied, which is how a revert ends up restoring a price
      // that never existed.
      this.logger.log(
        `Resuming activation of ${campaignId} from ${existing} existing row(s)`,
      );
    }

    const parked = await this.pushPrices(shop, jobId, hooks);
    if (parked) {
      /*
       * Shopify is still writing. Tags must not go on yet — they would appear
       * on products whose prices have not changed — and the campaign must not
       * be called ACTIVE, because it is not. The job comes back when the
       * operation finishes and picks up from here.
       */
      return {
        campaignId,
        status: campaign.status,
        waitingForBulk: true,
        ...(await this.progress(jobId)),
      };
    }

    await this.pushTags(shop, campaign, jobId);

    return this.finalise(shop, campaign, jobId);
  }

  /**
   * Insert every row before calling Shopify.
   *
   * A row that changes nothing is written SKIPPED rather than omitted: the
   * merchant's results screen should be able to say "we looked at 4,000
   * variants and 3,100 were already at that price", which an absent row
   * cannot.
   */
  private async writePlan(
    shop: Shop,
    campaign: Campaign,
    jobId: string,
    planned: PlannedChange[],
  ): Promise<void> {
    if (planned.length === 0) return;

    const rows = planned.map((change) =>
      this.priceChanges.create({
        shopId: shop.id,
        campaignId: campaign.id,
        jobId,
        shopifyProductId: change.shopifyProductId,
        shopifyVariantId: change.shopifyVariantId,
        productTitle: change.productTitle,
        variantTitle: change.variantTitle,
        oldPrice: change.oldPrice,
        oldCompareAtPrice: change.oldCompareAtPrice,
        newPrice: change.newPrice,
        newCompareAtPrice: change.newCompareAtPrice,
        currency: shop.currency,
        status: change.apply
          ? PriceChangeStatus.PENDING
          : PriceChangeStatus.SKIPPED,
        errorMessage: change.apply ? null : change.note,
      }),
    );

    // orIgnore: the unique index on (job_id, variant) is the retry guard, and
    // a re-insert is "already handled", not an error.
    await this.priceChanges
      .createQueryBuilder()
      .insert()
      .into(PriceChange)
      .values(rows)
      .orIgnore()
      .execute();
  }

  /**
   * Send the pending rows to Shopify, product by product.
   *
   * Only PENDING and FAILED rows are attempted. An APPLIED row is never
   * re-sent, which is what makes a retry safe on a run that got half way.
   */
  private async pushPrices(
    shop: Shop,
    jobId: string,
    hooks: ActivationHooks,
  ): Promise<boolean> {
    /*
     * Results of a bulk operation this job already submitted come first. On the
     * run that follows a `bulk_operations/finish` webhook the rows are still
     * PENDING — nothing has marked them — so skipping this would resubmit
     * prices Shopify has already written.
     */
    await this.absorbBulkResults(shop, jobId);

    const outstanding = await this.priceChanges.find({
      where: {
        jobId,
        status: In([PriceChangeStatus.PENDING, PriceChangeStatus.FAILED]),
      },
      order: { shopifyProductId: 'ASC' },
    });
    if (outstanding.length === 0) return false;

    /*
     * The size switch. Below the threshold the synchronous path is faster
     * end to end — a bulk operation would spend longer being staged, queued and
     * polled than the whole campaign takes to apply. Above it, per-product calls
     * spend most of their life waiting on the leaky bucket.
     *
     * `waitForBulk` missing means there is no job to park (a direct call, or a
     * test), so the synchronous path is the only one available whatever the
     * size.
     */
    if (shouldUseBulkOperation(outstanding.length) && hooks.waitForBulk) {
      return this.pushPricesInBulk(shop, jobId, outstanding, hooks);
    }

    await this.pushPricesSynchronously(shop, jobId, outstanding, hooks);
    return false;
  }

  /**
   * Submit one chunk as a bulk mutation and park the job on it.
   *
   * One chunk per run rather than all of them at once: Shopify runs a single
   * bulk mutation per shop at a time, so submitting the second would simply be
   * rejected. The job comes back when the operation finishes, absorbs the
   * results, and submits the next chunk — the loop is the queue, not a loop in
   * this function, which is what lets a worker restart in the middle of a
   * 40,000-variant campaign without losing its place.
   */
  private async pushPricesInBulk(
    shop: Shop,
    jobId: string,
    outstanding: PriceChange[],
    hooks: ActivationHooks,
  ): Promise<boolean> {
    if (hooks.shouldStop && (await hooks.shouldStop())) {
      this.logger.log(`Activation of job ${jobId} stopping before bulk submit`);
      return false;
    }

    const chunks = chunkForBulkMutation(outstanding);
    const chunk = chunks[0];
    if (!chunk) return false;

    const operation = await this.bulkOperations.runMutation(
      shop,
      BULK_VARIANT_PRICE_MUTATION,
      chunk.lines.map((line) => ({
        productId: line.productId,
        variants: line.variants,
      })),
      jobId,
    );

    this.logger.log(
      `Job ${jobId}: submitted ${chunk.variantIds.length} variant(s) as bulk ` +
        `operation ${operation.shopifyBulkOperationId} ` +
        `(chunk 1 of ${chunks.length})`,
    );

    await hooks.recordStep?.({
      bulkOperationId: operation.id,
      shopifyBulkOperationId: operation.shopifyBulkOperationId,
      submittedVariants: chunk.variantIds.length,
      remainingChunks: chunks.length - 1,
    });
    await hooks.waitForBulk?.(operation.id);
    return true;
  }

  /**
   * Read a finished bulk operation's JSONL onto the rows it wrote.
   *
   * Everything Shopify did not explicitly confirm stays PENDING and is picked
   * up by the next pass. That is the conservative direction on purpose: a row
   * marked APPLIED that never was leaves a price the app believes it set, and
   * revert would later "restore" over the merchant's real one.
   */
  private async absorbBulkResults(shop: Shop, jobId: string): Promise<void> {
    const job = await this.jobs.findById(shop.id, jobId);
    if (!job?.bulkOperationId) return;

    const operation = await this.bulkOperations.findById(job.bulkOperationId);
    if (!operation || !isTerminalBulkOperationStatus(operation.status)) return;

    if (operation.status !== BulkOperationStatus.COMPLETED) {
      /*
       * Failed, cancelled or expired. Partial results are still worth reading —
       * they say which prices really did reach the storefront, and that is the
       * only thing a revert can work from — but if there are none, the rows
       * stay PENDING and the next attempt resubmits them.
       */
      this.logger.warn(
        `Bulk operation ${operation.shopifyBulkOperationId} for job ${jobId} ` +
          `ended ${operation.status}` +
          (operation.errorCode ? ` (${operation.errorCode})` : ''),
      );
    }

    const lines: BulkMutationResultLine[] = [];
    if (operation.url ?? operation.partialDataUrl) {
      for await (const line of this.bulkOperations.readResults<BulkMutationResultLine>(
        operation,
      )) {
        lines.push(line);
      }
    }

    // Rebuilt rather than stored: the same query over the same unchanged rows
    // produces the same chunking, and the alternative is a quarter-megabyte of
    // variant ids in a jsonb column for every campaign.
    const outstanding = await this.priceChanges.find({
      where: {
        jobId,
        status: In([PriceChangeStatus.PENDING, PriceChangeStatus.FAILED]),
      },
      order: { shopifyProductId: 'ASC' },
    });
    const submitted = chunkForBulkMutation(outstanding)[0];

    if (submitted && lines.length > 0) {
      const outcomes = interpretBulkResults(submitted.lines, lines);
      const byVariant = new Map(
        outcomes.map((outcome) => [outcome.variantId, outcome]),
      );

      const now = new Date();
      const touched: PriceChange[] = [];
      for (const row of outstanding) {
        const outcome = byVariant.get(row.shopifyVariantId);
        if (!outcome) continue;

        if (outcome.applied) {
          row.status = PriceChangeStatus.APPLIED;
          row.appliedAt = now;
          row.errorMessage = null;
        } else {
          // PENDING, not FAILED: the operation as a whole may simply have been
          // cut short, and these have not been rejected on their merits.
          row.status = PriceChangeStatus.PENDING;
          row.errorMessage = outcome.error;
        }
        touched.push(row);
      }
      if (touched.length > 0) {
        await this.priceChanges.save(touched);
      }
    }

    // Released whatever happened, so the next chunk can park on its own
    // operation rather than finding this one still attached.
    await this.jobs.clearBulkOperation(jobId);
  }

  /** One product per call, in passes, for a campaign small enough to warrant it. */
  private async pushPricesSynchronously(
    shop: Shop,
    jobId: string,
    outstanding: PriceChange[],
    hooks: ActivationHooks,
  ): Promise<void> {
    const byProduct = new Map<string, PriceChange[]>();
    for (const row of outstanding) {
      const bucket = byProduct.get(row.shopifyProductId);
      if (bucket) bucket.push(row);
      else byProduct.set(row.shopifyProductId, [row]);
    }

    let sinceReport = 0;

    for (const [productId, rows] of byProduct) {
      // Cancellation is cooperative — checked between products, never mid-call.
      if (hooks.shouldStop && (await hooks.shouldStop())) {
        this.logger.log(`Activation of job ${jobId} stopping on request`);
        return;
      }

      const outcomes = await this.shopify.updateVariantPrices(
        shop,
        productId,
        rows.map((row) => ({
          variantId: row.shopifyVariantId,
          price: row.newPrice,
          compareAtPrice: row.newCompareAtPrice,
        })),
      );
      const byVariant = new Map(
        outcomes.map((outcome) => [outcome.variantId, outcome]),
      );

      const now = new Date();
      for (const row of rows) {
        const outcome = byVariant.get(row.shopifyVariantId);
        if (outcome?.applied) {
          row.status = PriceChangeStatus.APPLIED;
          row.appliedAt = now;
          row.errorMessage = null;
        } else {
          row.status = PriceChangeStatus.FAILED;
          row.errorMessage =
            outcome?.error ?? 'Shopify did not respond for this variant.';
        }
      }
      await this.priceChanges.save(rows);

      sinceReport += 1;
      if (hooks.onProgress && sinceReport >= PRODUCTS_PER_PASS) {
        sinceReport = 0;
        await hooks.onProgress(await this.progress(jobId));
      }
    }

    if (hooks.onProgress) {
      await hooks.onProgress(await this.progress(jobId));
    }
  }

  /**
   * Apply the campaign's tag changes, recording only what actually changed.
   *
   * If a product already carries a tag the campaign wanted to add, **no row is
   * written** — so deactivation later leaves the merchant's own tag alone.
   * This is the constitution's rule in practice: reverse from a record of what
   * was done, never from configuration.
   */
  private async pushTags(
    shop: Shop,
    campaign: Campaign,
    jobId: string,
  ): Promise<void> {
    if (campaign.addTags.length === 0 && campaign.removeTags.length === 0) {
      return;
    }

    const applied = await this.priceChanges.find({
      where: { jobId, status: PriceChangeStatus.APPLIED },
    });
    const productIds = [...new Set(applied.map((row) => row.shopifyProductId))];
    if (productIds.length === 0) return;

    for (const productId of productIds) {
      const [product] = await this.shopify.listProductVariants(shop, [
        productId,
      ]);
      if (!product) continue;

      const change = resolveTagChange(
        product.productTags,
        campaign.addTags,
        campaign.removeTags,
      );
      // Null means the tag set would not actually change.
      if (!change) continue;

      const result = await this.shopify.updateProductTags(
        shop,
        productId,
        change.newTags,
      );

      await this.tagChanges
        .createQueryBuilder()
        .insert()
        .into(ProductTagChange)
        .values({
          shopId: shop.id,
          campaignId: campaign.id,
          jobId,
          shopifyProductId: productId,
          oldTags: change.oldTags,
          newTags: change.newTags,
          status: result.applied
            ? ProductTagChangeStatus.APPLIED
            : ProductTagChangeStatus.FAILED,
          errorMessage: result.error,
          appliedAt: result.applied ? new Date() : null,
        })
        .orIgnore()
        .execute();
    }
  }

  // -------------------------------------------------------------------
  // Outcome
  // -------------------------------------------------------------------

  /**
   * Live counts, derived rather than denormalised.
   *
   * Counting `price_changes` through its `(shop_id, status)` index costs one
   * indexed query; keeping running totals on the campaign row would mean
   * locking it on every batch, which is a far worse trade at this size.
   */
  async progress(jobId: string): Promise<ActivationProgress> {
    const [row] = await this.dataSource.query<
      {
        total: string;
        applied: string;
        failed: string;
        skipped: string;
        pending: string;
      }[]
    >(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'APPLIED')::text AS applied,
              count(*) FILTER (WHERE status = 'FAILED')::text AS failed,
              count(*) FILTER (WHERE status = 'SKIPPED')::text AS skipped,
              count(*) FILTER (WHERE status = 'PENDING')::text AS pending
         FROM price_changes WHERE job_id = $1`,
      [jobId],
    );

    return {
      total: Number(row?.total ?? 0),
      applied: Number(row?.applied ?? 0),
      failed: Number(row?.failed ?? 0),
      skipped: Number(row?.skipped ?? 0),
      pending: Number(row?.pending ?? 0),
    };
  }

  /**
   * The outcome rule, written down rather than left to the UI.
   *
   * - Anything applied → **ACTIVE**. Prices are live and must be revertible,
   *   even if some rows failed.
   * - Nothing applied but something was attempted → **FAILED**.
   * - Nothing to do at all → **ACTIVE**, because the campaign is running
   *   correctly over an empty set; calling that a failure would have the
   *   merchant hunting a bug that is not there.
   *
   * A mixed run stays ACTIVE **and** carries a non-zero failure count. The
   * constitution's rule is that a failed update must never appear successful,
   * and the count is what stops it doing so — which is why `progress` is part
   * of the returned outcome and not an afterthought for the UI to compute.
   */
  private async finalise(
    shop: Shop,
    campaign: Campaign,
    jobId: string,
  ): Promise<ActivationOutcome> {
    const progress = await this.progress(jobId);

    const attempted = progress.applied + progress.failed;
    const status =
      attempted > 0 && progress.applied === 0
        ? CampaignStatus.FAILED
        : CampaignStatus.ACTIVE;

    await this.campaignsService.changeStatus(shop.id, campaign.id, status);
    await this.billing.reconcileUsage(shop.id);
    this.shopify.invalidate(shop.id);

    if (progress.failed > 0) {
      this.logger.warn(
        `Campaign ${campaign.id}: ${progress.applied} applied, ${progress.failed} failed`,
      );
    }

    return { campaignId: campaign.id, status, ...progress };
  }
}
