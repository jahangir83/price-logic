import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JobStep, JobType } from '@pricelogic/shared';
import { Repository } from 'typeorm';
import {
  JobHandlerRegistry,
  PermanentJobError,
  type JobContext,
} from '../jobs/job-handler';
import { Shop } from '../shops/entities/shop.entity';
import { ActivationService } from './activation.service';
import { RevertService } from './revert.service';

/**
 * Campaign activation, as a job.
 *
 * The handler is deliberately thin: it maps the engine's step sequence onto
 * `ActivationService` and translates a few failures into permanent ones. All
 * the judgement about partial failure lives in the service, where it can be
 * tested without a dispatcher.
 */
@Injectable()
export class CampaignJobHandlers implements OnModuleInit {
  private readonly logger = new Logger(CampaignJobHandlers.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly activation: ActivationService,
    private readonly revert: RevertService,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: JobType.CAMPAIGN_ACTIVATE,
      run: (context) => this.activate(context),
    });
    this.registry.register({
      type: JobType.CAMPAIGN_REVERT,
      run: (context) => this.revertCampaign(context),
    });
  }

  /**
   * Put a campaign's prices and tags back.
   *
   * Unlike activation, a revert that could not finish everything does **not**
   * fail the job outright — the rows it could not restore stay APPLIED, so the
   * next attempt picks them up. Failing here as well would only add noise to
   * a queue an operator is already going to look at.
   */
  private async revertCampaign(context: JobContext): Promise<void> {
    const campaignId = context.job.campaignId;
    if (!campaignId) {
      throw new PermanentJobError(
        'This job has no campaign attached.',
        'MISSING_CAMPAIGN_ID',
      );
    }

    const shop = await this.shops.findOne({
      where: { id: context.job.shopId },
    });
    if (!shop) {
      throw new PermanentJobError(
        'The shop is no longer connected.',
        'SHOP_DISCONNECTED',
      );
    }

    await context.advanceTo(JobStep.RESTORE_PRICES);

    const outcome = await this.revert.revert(shop, campaignId, {
      onProgress: async (progress) => {
        await context.report({
          total: progress.total,
          processed: progress.reverted + progress.skipped,
          failed: progress.failed,
        });
      },
      shouldStop: () => context.shouldStop(),
    });

    await context.advanceTo(JobStep.FINALIZE);

    this.logger.log(
      `Campaign ${campaignId} reverted: ${outcome.reverted} restored, ` +
        `${outcome.skipped} left alone, ${outcome.failed} failed, ` +
        `${outcome.tagsReverted} product(s) re-tagged`,
    );
  }

  private async activate(context: JobContext): Promise<void> {
    const campaignId = context.job.campaignId;
    if (!campaignId) {
      throw new PermanentJobError(
        'This job has no campaign attached.',
        'MISSING_CAMPAIGN_ID',
      );
    }

    const shop = await this.shops.findOne({
      where: { id: context.job.shopId },
    });
    if (!shop) {
      // Uninstalled while the campaign sat in the queue. No retry helps, and
      // retrying would keep trying to write to a store we cannot reach.
      throw new PermanentJobError(
        'The shop is no longer connected.',
        'SHOP_DISCONNECTED',
      );
    }

    await context.advanceTo(JobStep.RESOLVE_TARGETS);

    const outcome = await this.activation.activate(
      shop,
      campaignId,
      context.job.id,
      {
        onProgress: async (progress) => {
          await context.report({
            total: progress.total,
            processed: progress.applied + progress.skipped,
            failed: progress.failed,
          });
        },
        shouldStop: () => context.shouldStop(),
      },
    );

    await context.advanceTo(JobStep.FINALIZE);

    this.logger.log(
      `Campaign ${campaignId} finished ${outcome.status}: ` +
        `${outcome.applied} applied, ${outcome.failed} failed, ${outcome.skipped} skipped`,
    );

    /*
     * A run where nothing applied fails the *job* too, not just the campaign.
     * Leaving the job SUCCEEDED while every price failed is exactly the
     * "a failed update appears successful" case the constitution forbids —
     * and it would leave nothing in the queue for an operator to notice.
     */
    if (outcome.applied === 0 && outcome.failed > 0) {
      throw new Error(
        `No prices could be applied — ${outcome.failed} variant(s) were rejected by Shopify.`,
      );
    }
  }
}
