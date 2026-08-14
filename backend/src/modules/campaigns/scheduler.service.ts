import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { CampaignStatus, JobType } from '@pricelogic/shared';
import { Repository } from 'typeorm';
import { JobsService } from '../jobs/jobs.service';
import { Campaign } from './entities/campaign.entity';

export interface SchedulerSweep {
  activated: number;
  deactivated: number;
  missed: number;
}

/** Default grace: a campaign more than an hour late is not started. */
const DEFAULT_GRACE_MS = 60 * 60_000;

/**
 * Starts and ends campaigns when their schedule says so.
 *
 * **Claiming is the deduplication key, not a status.** Two schedulers finding
 * the same due campaign both call `enqueue` with `activate:<id>`; the partial
 * unique index on `(shop_id, dedup_key)` collapses them into one job, and the
 * `campaign-exec` concurrency key stops that job overlapping anything else for
 * the shop. Adding a CLAIMED status would be a second mechanism doing the same
 * work, with its own way to get stuck.
 */
@Injectable()
export class CampaignSchedulerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private readonly graceMs: number;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Campaign)
    private readonly campaigns: Repository<Campaign>,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {
    this.graceMs =
      config.get<number>('scheduler.activationGraceMs') ?? DEFAULT_GRACE_MS;
    this.intervalMs = config.get<number>('scheduler.intervalMs') ?? 30_000;
  }

  onModuleInit(): void {
    // Disabled in tests: a background sweep racing an assertion about a
    // SCHEDULED campaign makes the suite flaky, exactly as with the
    // dispatcher.
    if (this.config.get<string>('scheduler.enabled') === 'false') {
      this.logger.log('Campaign scheduler disabled by configuration');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Campaign scheduler started (every ${this.intervalMs}ms)`);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One guarded pass — overlapping sweeps would enqueue the same work twice. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.sweep();
      if (result.activated || result.deactivated || result.missed) {
        this.logger.log(
          `Sweep: ${result.activated} started, ${result.deactivated} ended, ${result.missed} missed`,
        );
      }
    } catch (error) {
      // A failed sweep must never kill the timer; the next one tries again.
      this.logger.error(
        `Scheduler sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** One pass. Exposed so tests and the job runner can drive it directly. */
  async sweep(now: Date = new Date()): Promise<SchedulerSweep> {
    const [activated, missed] = await this.startDueCampaigns(now);
    const deactivated = await this.endDueCampaigns(now);
    return { activated, deactivated, missed };
  }

  /**
   * Start what is due, and give up on what is too late.
   *
   * A campaign whose start passed while the app was down is a judgement call.
   * Inside the grace period it starts late, because a sale beginning twenty
   * minutes behind schedule is what the merchant wanted. Beyond it the
   * campaign is FAILED with a reason — silently starting a Black Friday sale
   * on the Monday after is worse than not starting it.
   */
  private async startDueCampaigns(now: Date): Promise<[number, number]> {
    const due = await this.campaigns
      .createQueryBuilder('c')
      .where('c.status = :status', { status: CampaignStatus.SCHEDULED })
      .andWhere('c.start_at IS NOT NULL AND c.start_at <= :now', { now })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('c.start_at', 'ASC')
      .limit(500)
      .getMany();

    let activated = 0;
    let missed = 0;

    for (const campaign of due) {
      const lateBy = now.getTime() - (campaign.startAt?.getTime() ?? 0);

      if (lateBy > this.graceMs) {
        await this.campaigns.update(
          { id: campaign.id },
          { status: CampaignStatus.FAILED },
        );
        this.logger.warn(
          `Campaign ${campaign.id} missed its start by ${Math.round(lateBy / 60_000)} minutes and was not run`,
        );
        missed += 1;
        continue;
      }

      await this.jobs.enqueue(campaign.shopId, {
        type: JobType.CAMPAIGN_ACTIVATE,
        campaignId: campaign.id,
        concurrencyKey: 'campaign-exec',
        dedupKey: `activate:${campaign.id}`,
      });
      activated += 1;
    }

    return [activated, missed];
  }

  /**
   * End what is due. **No grace period, ever.**
   *
   * A campaign whose end passed while the app was down must still be reverted,
   * however late. Leaving prices discounted indefinitely because a worker was
   * offline is the worst bug this application can have — it costs the merchant
   * money on every order, silently, for as long as nobody notices.
   */
  private async endDueCampaigns(now: Date): Promise<number> {
    const due = await this.campaigns
      .createQueryBuilder('c')
      .where('c.status = :status', { status: CampaignStatus.ACTIVE })
      .andWhere('c.end_at IS NOT NULL AND c.end_at <= :now', { now })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('c.end_at', 'ASC')
      .limit(500)
      .getMany();

    for (const campaign of due) {
      const lateBy = now.getTime() - (campaign.endAt?.getTime() ?? 0);
      if (lateBy > this.graceMs) {
        this.logger.warn(
          `Campaign ${campaign.id} is ${Math.round(lateBy / 60_000)} minutes past its end — reverting now`,
        );
      }

      await this.jobs.enqueue(campaign.shopId, {
        type: JobType.CAMPAIGN_REVERT,
        campaignId: campaign.id,
        concurrencyKey: 'campaign-exec',
        dedupKey: `revert:${campaign.id}`,
        // Ahead of an activation, so a shop with both queued puts prices back
        // before it starts anything new.
        priority: 10,
      });
    }

    return due.length;
  }
}
