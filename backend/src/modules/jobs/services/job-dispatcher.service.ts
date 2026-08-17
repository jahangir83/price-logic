import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobExecutionStatus, JobStep } from '@pricelogic/shared';
import {
  ChildJobSpec,
  JobContext,
  JobHandlerRegistry,
  PermanentJobError,
} from '../job-handler';
import { JobsService } from './jobs.service';
import { Job } from '../entities/job.entity';

export interface DispatcherOptions {
  /** How often to look for work when the last poll found none. */
  pollIntervalMs?: number;
  /** Jobs this worker will run at once. */
  concurrency?: number;
  /** A RUNNING job untouched for this long is assumed to be an orphan. */
  staleLockMs?: number;
}

/**
 * The polling loop.
 *
 * Postgres is the queue: `next_run_at` + `locked_at` + `FOR UPDATE SKIP
 * LOCKED`, no Redis and no broker. When a broker does arrive it replaces this
 * class and nothing else — job rows stay the source of truth, so the swap
 * needs no migration and loses no history.
 *
 * Not started automatically in tests. `JOBS_DISPATCHER_ENABLED=false` keeps it
 * dormant, because an integration test that asserts a job is PENDING should
 * not race a background loop that is trying to run it.
 */
@Injectable()
export class JobDispatcherService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(JobDispatcherService.name);

  /** Identifies this process's claims so a restart can release exactly them. */
  readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private draining = false;
  private readonly inFlight = new Set<Promise<void>>();

  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly staleLockMs: number;

  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
    private readonly config: ConfigService,
  ) {
    this.pollIntervalMs =
      this.config.get<number>('jobs.pollIntervalMs') ?? 1000;
    this.concurrency = this.config.get<number>('jobs.concurrency') ?? 2;
    this.staleLockMs = this.config.get<number>('jobs.staleLockMs') ?? 300_000;
  }

  onModuleInit(): void {
    if (this.config.get<string>('jobs.dispatcherEnabled') === 'false') {
      this.logger.log('Job dispatcher disabled by configuration');
      return;
    }
    this.start();
  }

  /**
   * Stop taking work, let what is in flight finish, then hand back the claims.
   *
   * Releasing explicitly matters: without it every job this worker held stays
   * RUNNING and untouchable until the stale-lock timeout, so a rolling deploy
   * would stall the queue for minutes for no reason.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(options: DispatcherOptions = {}): void {
    if (this.timer) return;
    this.draining = false;
    const interval = options.pollIntervalMs ?? this.pollIntervalMs;
    this.timer = setInterval(() => void this.tick(), interval);
    // Never hold the process open on our account.
    this.timer.unref?.();
    this.logger.log(
      `Job dispatcher started (worker=${this.workerId}, handlers=[${this.registry
        .types()
        .join(', ')}])`,
    );
  }

  async stop(): Promise<void> {
    this.draining = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.allSettled([...this.inFlight]);
    const released = await this.jobs.releaseClaims(this.workerId);
    if (released > 0) {
      this.logger.log(`Released ${released} claim(s) on shutdown`);
    }
  }

  /** One poll. Exposed so tests can drive the loop deterministically. */
  async tick(): Promise<void> {
    if (this.running || this.draining) return;
    this.running = true;
    try {
      await this.jobs.reclaimStale(this.staleLockMs);

      while (this.inFlight.size < this.concurrency && !this.draining) {
        const job = await this.jobs.claimNext(this.workerId);
        if (!job) break;

        const execution = this.execute(job).finally(() => {
          this.inFlight.delete(execution);
        });
        this.inFlight.add(execution);
      }
    } catch (error) {
      // A failed poll must never kill the loop — the next tick tries again.
      this.logger.error(
        `Dispatcher tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Wait for in-flight work. Tests use this instead of sleeping. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.registry.get(job.type);
    if (!handler) {
      // Not retryable: a missing handler is a deployment problem, and
      // retrying it five times just delays the alert.
      await this.jobs.fail(
        job.id,
        `No handler registered for job type ${job.type}`,
        { code: 'NO_HANDLER', retryable: false },
      );
      return;
    }

    let spawnedChildren = false;
    let waitingForBulk = false;

    const context: JobContext = {
      job,
      advance: () => this.jobs.advanceToNextStep(job.id),
      advanceTo: (step: JobStep) => this.jobs.advanceToStep(job.id, step),
      report: (counts) => this.jobs.recordProgress(job.id, counts),
      shouldStop: () => this.jobs.isCancelRequested(job.id),
      spawnChildren: async (specs: ChildJobSpec[]) => {
        await this.jobs.spawnChildren(job.shopId, job.id, specs);
        spawnedChildren = true;
      },
      recordStep: async (result: Record<string, unknown>) => {
        const execution = await this.jobs.currentExecution(job.id);
        if (!execution) return;
        await this.jobs.finishStep(
          job.id,
          execution.step,
          JobExecutionStatus.SUCCEEDED,
          result,
        );
      },
      stepResult: (step: JobStep) => this.jobs.stepResult(job.id, step),
      waitForBulkOperation: async (bulkOperationId: string) => {
        await this.jobs.parkOnBulkOperation(job.id, bulkOperationId);
        waitingForBulk = true;
      },
    };

    try {
      const result = await handler.run(context);

      if (await this.jobs.isCancelRequested(job.id)) {
        await this.jobs.confirmCancelled(job.id);
        return;
      }
      // A job that handed its work to children is not finished — it waits for
      // them, and settles when the last one does.
      if (spawnedChildren || result?.spawnedChildren) {
        return;
      }
      // Nor is one waiting on Shopify. Completing it here would report a
      // campaign applied while the bulk operation is still writing prices.
      if (waitingForBulk || result?.waitingForBulk) {
        return;
      }
      await this.jobs.complete(job.id, result?.result ?? {});
    } catch (error) {
      if (error instanceof PermanentJobError) {
        await this.jobs.fail(job.id, error.message, {
          code: error.code,
          details: error.details,
          retryable: false,
        });
        return;
      }
      await this.jobs.fail(
        job.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
