import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isTerminalBulkOperationStatus } from '@pricelogic/shared';
import { JobsService } from '../../jobs/services/jobs.service';
import { BulkOperationService } from '../../shopify/services/bulk-operation.service';
import { ShopsService } from '../../shops/services/shops.service';

/**
 * How often the backstop sweep runs.
 *
 * Deliberately slow. The webhook is the real mechanism and arrives in seconds;
 * this only exists for the deliveries that never come, and polling Shopify for
 * every in-flight operation every few seconds would spend the shop's rate limit
 * on a question that is nearly always already answered.
 */
const DEFAULT_SWEEP_MS = 60_000;

/**
 * The bridge between a Shopify bulk operation finishing and the job waiting on
 * it waking up.
 *
 * It lives here rather than in either module it joins. The job engine is
 * deliberately ignorant of Shopify — it knows how to claim, retry and finish
 * work, and nothing about what the work is — and the Shopify adapter is
 * deliberately ignorant of jobs. Putting the coupling in one small service on
 * the integration side keeps both of those true, and puts it next to the
 * webhook that triggers it.
 */
@Injectable()
export class BulkOperationCoordinator
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(BulkOperationCoordinator.name);
  private readonly sweepMs: number;
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly bulkOperations: BulkOperationService,
    private readonly jobs: JobsService,
    private readonly shops: ShopsService,
    private readonly config: ConfigService,
  ) {
    this.sweepMs =
      this.config.get<number>('jobs.bulkSweepMs') ?? DEFAULT_SWEEP_MS;
  }

  onModuleInit(): void {
    // Off in tests for the same reason as the dispatcher and the scheduler: a
    // background sweep racing an assertion makes the suite flaky.
    if (this.config.get<string>('jobs.dispatcherEnabled') === 'false') {
      return;
    }
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref?.();
    this.logger.log(
      `Bulk operation sweep started (every ${this.sweepMs}ms, as a backstop for the finish webhook)`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One guarded pass; overlapping sweeps would poll the same operations twice. */
  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const settled = await this.pollUnfinished();
      if (settled > 0) {
        this.logger.log(
          `Sweep settled ${settled} bulk operation(s) whose webhook never arrived`,
        );
      }
    } catch (error) {
      // A failed sweep must never kill the timer.
      this.logger.error(
        `Bulk operation sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Record a finished operation and release its job.
   *
   * Called from the `bulk_operations/finish` webhook. Unknown operation ids are
   * logged and ignored rather than raising: Shopify sends this topic for
   * *every* bulk operation on the shop, including ones another integration
   * started, and treating those as errors would fill the delivery log with
   * failures that mean nothing.
   */
  async handleFinished(
    shopifyBulkOperationId: string,
    status: string,
  ): Promise<void> {
    const operation = await this.bulkOperations.findByShopifyId(
      shopifyBulkOperationId,
    );
    if (!operation) {
      this.logger.debug(
        `bulk_operations/finish for an operation we did not start: ${shopifyBulkOperationId}`,
      );
      return;
    }

    /*
     * The webhook says an operation finished but not where its results are, so
     * the status is re-read from the API. Trusting the payload's status alone
     * would leave `url` null on a COMPLETED operation, and the woken job would
     * find nothing to download.
     */
    const shop = await this.shops.findById(operation.shopId);
    const updated = shop
      ? await this.bulkOperations.refresh(shop, operation)
      : await this.bulkOperations.applyStatus(operation, {
          id: shopifyBulkOperationId,
          status,
        });

    if (!isTerminalBulkOperationStatus(updated.status)) {
      // CANCELING, most likely: the operation is still running and another
      // notification is coming.
      return;
    }

    const resumed = await this.jobs.resumeFromBulkOperation(updated.id);
    if (!resumed) {
      this.logger.debug(
        `Bulk operation ${shopifyBulkOperationId} finished with no job waiting on it`,
      );
    }
  }

  /**
   * Sweep operations that never reported in.
   *
   * The backstop for a webhook that was dropped, or delivered while the app was
   * down. Without it a job parks on an operation Shopify has long since
   * finished and waits forever — nothing else would ever notice, because a
   * WAITING_BULK job is not claimable and so never trips the stale-lock check.
   */
  async pollUnfinished(): Promise<number> {
    const outstanding = await this.bulkOperations.findUnfinished();
    let settled = 0;

    for (const operation of outstanding) {
      const shop = await this.shops.findById(operation.shopId);
      if (!shop) continue;

      try {
        const updated = await this.bulkOperations.refresh(shop, operation);
        if (isTerminalBulkOperationStatus(updated.status)) {
          await this.jobs.resumeFromBulkOperation(updated.id);
          settled += 1;
        }
      } catch (error) {
        // One unreachable shop must not stop the sweep for every other.
        this.logger.warn(
          `Could not refresh bulk operation ${operation.shopifyBulkOperationId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    return settled;
  }
}
