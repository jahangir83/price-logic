import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  JobExecutionStatus,
  JobStatus,
  JobStep,
  JobType,
  LIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  firstJobStep,
  isTerminalJobStatus,
  nextJobStep,
} from '@pricelogic/shared';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { BackoffOptions, nextRunAtFor } from '../backoff';
import { JobDependency } from '../entities/job-dependency.entity';
import { JobExecution } from '../entities/job-execution.entity';
import { JobStepResult } from '../entities/job-step-result.entity';
import { Job } from '../entities/job.entity';

export interface EnqueueJobSpec {
  type: JobType;
  campaignId?: string | null;
  csvImportId?: string | null;
  concurrencyKey?: string | null;
  dedupKey?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number | null;
  nextRunAt?: Date | null;
  parentJobId?: string | null;
  /** Job ids this job must wait for. Any terminal state releases it. */
  dependsOn?: string[];
}

export interface FailJobOptions {
  /** Stable code the UI branches on, e.g. `PLAN_LIMIT_EXCEEDED`. */
  code?: string;
  details?: Record<string, unknown>;
  /**
   * Whether another attempt could plausibly succeed. Defaults to true.
   * A plan-limit rejection is not retryable — the answer will not change on
   * its own, and retrying it just burns attempts and confuses the merchant.
   */
  retryable?: boolean;
}

const STALE_LOCK_MS = 5 * 60_000;

/**
 * TypeORM's `update()` set-type does not accept a plain `Record<string,
 * unknown>` for a jsonb column — it widens to a value-or-SQL-expression union
 * that a bare object does not satisfy. Casting the one field keeps the rest of
 * the payload type-checked, which a cast on the whole object would not.
 */
const asJson = <T>(value: Record<string, unknown> | null): T =>
  value as unknown as T;

/** Errors that must never be retried, whatever the caller passes. */
const NON_RETRYABLE_CODES = new Set(['PLAN_LIMIT_EXCEEDED']);

/**
 * The job engine: everything that happens to a job between being asked for and
 * being finished.
 *
 * **Deliberately not tenant-scoped.** `TenantScopedRepository` exists so a
 * request handler cannot read across shops, but the dispatcher is not acting
 * for a merchant — it claims due work across every shop, and scoping it to one
 * would make it useless. Every write here still sets `shop_id` explicitly, and
 * the composite foreign keys from J1 make a cross-tenant row unrepresentable
 * regardless of what this class does. Callers acting for a merchant pass their
 * own `shopId` and must never take it from a request body.
 *
 * Concurrency and deduplication are enforced by partial unique indexes, not by
 * the checks in this file. The checks exist to avoid pointless work; the
 * indexes exist because a check-then-act is a race no matter how carefully it
 * is written.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // -------------------------------------------------------------------
  // Enqueueing
  // -------------------------------------------------------------------

  /**
   * Create a job, or return the live one already holding its dedup key.
   *
   * A double click, a redelivered webhook and a scheduler firing twice must
   * all be indistinguishable from a single request to the caller — so this
   * returns the existing job rather than raising.
   */
  async enqueue(shopId: string, spec: EnqueueJobSpec): Promise<Job> {
    return this.dataSource.transaction(async (manager) => {
      if (spec.dedupKey) {
        const existing = await manager.findOne(Job, {
          where: {
            shopId,
            dedupKey: spec.dedupKey,
            status: In([...LIVE_JOB_STATUSES]),
          },
        });
        if (existing) {
          this.logger.debug(
            `Deduplicated job ${spec.type} for shop ${shopId} onto ${existing.id}`,
          );
          return existing;
        }
      }

      const dependsOn = spec.dependsOn ?? [];
      const job = manager.create(Job, {
        shopId,
        type: spec.type,
        // A job with unmet dependencies must never be claimable, so it is
        // created BLOCKED rather than created PENDING and corrected after.
        status: dependsOn.length > 0 ? JobStatus.BLOCKED : JobStatus.PENDING,
        campaignId: spec.campaignId ?? null,
        csvImportId: spec.csvImportId ?? null,
        concurrencyKey: spec.concurrencyKey ?? null,
        dedupKey: spec.dedupKey ?? null,
        payload: spec.payload ?? {},
        priority: spec.priority ?? 0,
        maxAttempts: spec.maxAttempts === undefined ? 5 : spec.maxAttempts,
        nextRunAt: spec.nextRunAt ?? null,
        parentJobId: spec.parentJobId ?? null,
      });

      const saved = await manager.save(Job, job);

      if (dependsOn.length > 0) {
        // Through the entity, not a table name: a raw `.into('job_dependencies')`
        // bypasses column mapping and silently inserts nulls.
        await manager
          .createQueryBuilder()
          .insert()
          .into(JobDependency)
          .values(
            dependsOn.map((dependsOnJobId) => ({
              shopId,
              jobId: saved.id,
              dependsOnJobId,
            })),
          )
          .orIgnore()
          .execute();

        // The dependencies may already have finished between the caller
        // reading them and this transaction committing.
        await this.releaseIfUnblocked(manager, saved.id);
        return manager.findOneOrFail(Job, { where: { id: saved.id } });
      }

      return saved;
    });
  }

  /**
   * Enqueue behind everything the shop already has in flight.
   *
   * This is what makes three campaigns edited at once run strictly one after
   * another, in the order the merchant edited them — the concurrency key stops
   * them overlapping, and this edge fixes which one goes first.
   */
  async enqueueSerialized(shopId: string, spec: EnqueueJobSpec): Promise<Job> {
    const blockers = await this.dataSource.getRepository(Job).find({
      where: { shopId, status: In([...LIVE_JOB_STATUSES]) },
      select: ['id'],
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const dependsOn = [
      ...(spec.dependsOn ?? []),
      ...blockers.map((blocker) => blocker.id),
    ];
    return this.enqueue(shopId, { ...spec, dependsOn });
  }

  // -------------------------------------------------------------------
  // Claiming
  // -------------------------------------------------------------------

  /**
   * Take the next due job for this worker, or null when there is none.
   *
   * One job at a time and one transaction each: the concurrency index can
   * reject a claim, and a batch would lose the whole batch to one rejection.
   *
   * `FOR UPDATE ... SKIP LOCKED` is what lets several workers poll the same
   * table without serialising on each other — a locked row is passed over
   * rather than waited for.
   */
  async claimNext(workerId: string): Promise<Job | null> {
    return this.dataSource
      .transaction(async (manager) => {
        const rows: { id: string }[] = await manager.query(
          `
        SELECT j."id"
          FROM "jobs" j
         WHERE j."status" = $1
           AND (j."next_run_at" IS NULL OR j."next_run_at" <= now())
           AND (
             j."concurrency_key" IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM "jobs" r
                WHERE r."shop_id" = j."shop_id"
                  AND r."concurrency_key" = j."concurrency_key"
                  AND r."status" = $2
             )
           )
         ORDER BY j."priority" DESC, j."created_at" ASC
           FOR UPDATE OF j SKIP LOCKED
         LIMIT 1
        `,
          [JobStatus.PENDING, JobStatus.RUNNING],
        );

        const candidate = rows[0];
        if (!candidate) {
          return null;
        }

        const job = await manager.findOneOrFail(Job, {
          where: { id: candidate.id },
        });

        job.status = JobStatus.RUNNING;
        job.attempts += 1;
        job.lockedAt = new Date();
        job.lockedBy = workerId;
        job.startedAt = job.startedAt ?? new Date();
        job.nextRunAt = null;

        try {
          await manager.save(Job, job);
        } catch (error) {
          // The concurrency index refused: another worker started a job with
          // the same key between the NOT EXISTS above and this write. Not an
          // error — the dispatcher simply gets nothing this tick.
          if (isUniqueViolation(error)) {
            this.logger.debug(
              `Concurrency key busy for job ${job.id}; leaving it queued`,
            );
            throw new ClaimRaceError();
          }
          throw error;
        }

        /*
         * An execution row for this attempt may already exist. Both
         * `reclaimStale` and a job coming back from a bulk operation hand the
         * attempt back rather than consuming it — the job never got a fair try
         * — so the next claim lands on the same attempt number. Inserting a
         * second row would violate `UQ_job_executions_job_attempt` and, because
         * that insert sits outside the claim's own error handling, would throw
         * out of the dispatcher tick and leave the job unclaimable in a loop.
         *
         * The existing row is resumed instead, keeping the step it reached:
         * that is the same attempt continuing, not a new one.
         */
        const existing = await manager.findOne(JobExecution, {
          where: { jobId: job.id, attempt: job.attempts },
        });
        const step = existing?.step ?? firstJobStep(job.type);

        if (existing) {
          await manager.update(
            JobExecution,
            { id: existing.id },
            { status: JobExecutionStatus.RUNNING, finishedAt: null },
          );
        } else {
          await manager.save(
            JobExecution,
            manager.create(JobExecution, {
              shopId: job.shopId,
              jobId: job.id,
              attempt: job.attempts,
              status: JobExecutionStatus.RUNNING,
              step,
              startedAt: new Date(),
            }),
          );
        }
        await this.openStep(manager, job.shopId, job.id, step);

        return job;
      })
      .catch((error: unknown) => {
        if (error instanceof ClaimRaceError) {
          return null;
        }
        throw error;
      });
  }

  /**
   * Return jobs whose worker died to the queue.
   *
   * The attempt is **not** consumed: the job never got a fair try, and
   * charging it one would retire a job after a few unlucky deploys.
   */
  async reclaimStale(staleMs: number = STALE_LOCK_MS): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs);
    const result = await this.dataSource
      .createQueryBuilder()
      .update(Job)
      .set({
        status: JobStatus.PENDING,
        lockedAt: null,
        lockedBy: null,
        attempts: () => '"attempts" - 1',
      })
      .where('status = :status', { status: JobStatus.RUNNING })
      .andWhere('locked_at IS NOT NULL AND locked_at < :cutoff', { cutoff })
      .execute();

    const reclaimed = result.affected ?? 0;
    if (reclaimed > 0) {
      this.logger.warn(`Reclaimed ${reclaimed} job(s) from a stale lock`);
    }
    return reclaimed;
  }

  // -------------------------------------------------------------------
  // Execution lifecycle
  // -------------------------------------------------------------------

  /** The execution row for the job's current attempt. */
  async currentExecution(jobId: string): Promise<JobExecution | null> {
    return this.dataSource.getRepository(JobExecution).findOne({
      where: { jobId, obsolete: false },
      order: { attempt: 'DESC' },
    });
  }

  /**
   * Move to a named step, resetting progress within it.
   *
   * Closes the step being left as SUCCEEDED and opens the new one. Leaving a
   * step is the only evidence the engine has that it finished — a handler that
   * advances has, by definition, got past it.
   */
  async advanceToStep(jobId: string, step: JobStep): Promise<void> {
    const execution = await this.currentExecution(jobId);
    if (!execution) return;

    if (execution.step !== step) {
      await this.finishStep(
        jobId,
        execution.step,
        JobExecutionStatus.SUCCEEDED,
      );
    }
    await this.dataSource
      .getRepository(JobExecution)
      .update({ id: execution.id }, { step, progress: 0 });
    await this.beginStep(jobId, step);
  }

  // -------------------------------------------------------------------
  // Step results
  // -------------------------------------------------------------------

  /**
   * Open a step, or re-open it on a retry.
   *
   * `tries` counts re-entries rather than being reset, so a step that keeps
   * failing is visible as such without reading every execution row.
   */
  async beginStep(jobId: string, step: JobStep): Promise<void> {
    const job = await this.dataSource
      .getRepository(Job)
      .findOne({ where: { id: jobId }, select: ['id', 'shopId'] });
    if (!job) return;
    await this.openStep(this.dataSource.manager, job.shopId, jobId, step);
  }

  private async openStep(
    manager: EntityManager,
    shopId: string,
    jobId: string,
    step: JobStep,
  ): Promise<void> {
    /*
     * One statement, because two workers can re-enter the same step at once
     * after a stale-lock reclaim. `tries` is incremented from the stored row
     * rather than written from here — the query builder's `orUpdate` can only
     * copy the values being inserted, which would write 1 on every retry and
     * leave the count permanently stuck at 1.
     */
    await manager.query(
      `
      INSERT INTO "job_step_results"
             ("shop_id", "job_id", "step", "status", "tries", "started_at")
      VALUES ($1, $2, $3, $4, 1, now())
      ON CONFLICT ("job_id", "step") DO UPDATE
         SET "status"      = $4,
             "tries"       = "job_step_results"."tries" + 1,
             "started_at"  = now(),
             "finished_at" = NULL,
             "updated_at"  = now()
      `,
      [shopId, jobId, step, JobExecutionStatus.RUNNING],
    );
  }

  /** Record how a step ended, and what it produced. */
  async finishStep(
    jobId: string,
    step: JobStep,
    status: JobExecutionStatus,
    result: Record<string, unknown> | null = null,
    errorMessage: string | null = null,
  ): Promise<void> {
    const existing = await this.dataSource
      .getRepository(JobStepResult)
      .findOne({ where: { jobId, step } });

    // A step that never opened — a handler jumping straight to FINALIZE, say —
    // still gets a row, because "this step did not run" and "this step left no
    // record" are different answers to the same question.
    if (!existing) {
      await this.beginStep(jobId, step);
    }

    await this.dataSource.getRepository(JobStepResult).update(
      { jobId, step },
      {
        status,
        // A result of `null` must not erase what the step already recorded:
        // `advanceToStep` closes a step without one, and the handler may have
        // written its result moments earlier.
        ...(result === null
          ? {}
          : {
              result:
                asJson<QueryDeepPartialEntity<JobStepResult>['result']>(result),
            }),
        errorMessage,
        finishedAt: new Date(),
      },
    );
  }

  /**
   * What an earlier step produced.
   *
   * This is what makes a retry cheap: activation resolves 4,000 targets, fails
   * on the push, and the next attempt reads the resolved set back rather than
   * re-resolving it — which would also re-read prices that have since been
   * changed by the half-finished run.
   */
  async stepResult<T = Record<string, unknown>>(
    jobId: string,
    step: JobStep,
  ): Promise<T | null> {
    const row = await this.dataSource.getRepository(JobStepResult).findOne({
      where: { jobId, step, status: JobExecutionStatus.SUCCEEDED },
    });
    return (row?.result as T | null) ?? null;
  }

  /** Every step of a job, in the order they were first entered. */
  async stepResults(jobId: string): Promise<JobStepResult[]> {
    return this.dataSource.getRepository(JobStepResult).find({
      where: { jobId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Move to whatever follows the current step for this job's type. */
  async advanceToNextStep(jobId: string): Promise<JobStep | null> {
    const job = await this.dataSource
      .getRepository(Job)
      .findOneOrFail({ where: { id: jobId } });
    const execution = await this.currentExecution(jobId);
    if (!execution) return null;

    const next = nextJobStep(job.type, execution.step);
    if (next) {
      await this.advanceToStep(jobId, next);
    }
    return next;
  }

  async recordProgress(
    jobId: string,
    counts: { processed?: number; failed?: number; total?: number },
  ): Promise<void> {
    const job = await this.dataSource
      .getRepository(Job)
      .findOneOrFail({ where: { id: jobId } });

    if (counts.total !== undefined) job.totalCount = counts.total;
    if (counts.processed !== undefined) job.processedCount = counts.processed;
    if (counts.failed !== undefined) job.failedCount = counts.failed;
    await this.dataSource.getRepository(Job).save(job);

    const execution = await this.currentExecution(jobId);
    if (execution && counts.processed !== undefined) {
      await this.dataSource
        .getRepository(JobExecution)
        .update({ id: execution.id }, { progress: counts.processed });
    }
  }

  async complete(
    jobId: string,
    result: Record<string, unknown> = {},
  ): Promise<void> {
    const finalStep = await this.currentExecution(jobId);
    if (finalStep) {
      // The step the handler ended on closes with the job's own result, so the
      // last step is not the one step with nothing recorded against it.
      await this.finishStep(
        jobId,
        finalStep.step,
        JobExecutionStatus.SUCCEEDED,
        Object.keys(result).length > 0 ? result : null,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await this.closeExecution(
        manager,
        jobId,
        JobExecutionStatus.SUCCEEDED,
        result,
      );
      await manager.update(
        Job,
        { id: jobId },
        {
          status: JobStatus.SUCCEEDED,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      );
      await this.onTerminal(manager, jobId);
    });
  }

  /**
   * Fail an attempt, retrying it unless the failure is permanent or the job
   * has run out of attempts.
   */
  async fail(
    jobId: string,
    error: string,
    options: FailJobOptions = {},
    backoff: BackoffOptions = {},
  ): Promise<JobStatus> {
    /*
     * Record which step failed before anything else. A retry re-enters at this
     * step, and an operator reading the queue needs to know it was PUSH_PRICES
     * that broke rather than the whole job — the difference decides whether
     * anything reached Shopify at all.
     */
    const failedAt = await this.currentExecution(jobId);
    if (failedAt) {
      await this.finishStep(
        jobId,
        failedAt.step,
        JobExecutionStatus.FAILED,
        null,
        error,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOneOrFail(Job, { where: { id: jobId } });

      const retryable =
        (options.retryable ?? true) &&
        !(options.code !== undefined && NON_RETRYABLE_CODES.has(options.code));
      const exhausted =
        job.maxAttempts !== null && job.attempts >= job.maxAttempts;

      await this.closeExecution(
        manager,
        jobId,
        JobExecutionStatus.FAILED,
        null,
        error,
      );

      if (retryable && !exhausted) {
        await manager.update(
          Job,
          { id: jobId },
          {
            status: JobStatus.PENDING,
            lastError: error,
            errorCode: options.code ?? null,
            errorDetails: asJson<QueryDeepPartialEntity<Job>['errorDetails']>(
              options.details ?? null,
            ),
            lockedAt: null,
            lockedBy: null,
            nextRunAt: nextRunAtFor(job.attempts, new Date(), backoff),
          },
        );
        return JobStatus.PENDING;
      }

      await manager.update(
        Job,
        { id: jobId },
        {
          status: JobStatus.FAILED,
          lastError: error,
          errorCode: options.code ?? null,
          errorDetails: asJson<QueryDeepPartialEntity<Job>['errorDetails']>(
            options.details ?? null,
          ),
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      );
      await this.onTerminal(manager, jobId);
      return JobStatus.FAILED;
    });
  }

  private async closeExecution(
    manager: EntityManager,
    jobId: string,
    status: JobExecutionStatus,
    result: Record<string, unknown> | null = null,
    errorMessage: string | null = null,
  ): Promise<void> {
    const execution = await manager.findOne(JobExecution, {
      where: { jobId, obsolete: false },
      order: { attempt: 'DESC' },
    });
    if (!execution) return;
    await manager.update(
      JobExecution,
      { id: execution.id },
      {
        status,
        result: asJson<QueryDeepPartialEntity<JobExecution>['result']>(result),
        errorMessage,
        finishedAt: new Date(),
      },
    );
  }

  // -------------------------------------------------------------------
  // Pause, resume, cancel
  // -------------------------------------------------------------------

  /**
   * Ask a job to stop. **Cooperative** — a RUNNING job is flagged and stops
   * itself between steps. Killing it mid-mutation would leave a half-applied
   * campaign with no record of what already reached Shopify, which is exactly
   * the state undo cannot recover from.
   */
  async requestCancel(shopId: string, jobId: string): Promise<JobStatus> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOneOrFail(Job, {
        where: { id: jobId, shopId },
      });
      if (isTerminalJobStatus(job.status)) {
        return job.status;
      }

      if (job.status === JobStatus.RUNNING) {
        await manager.update(
          Job,
          { id: jobId },
          { cancelRequestedAt: new Date() },
        );
        return JobStatus.RUNNING;
      }

      // Not started, so it can be cancelled outright.
      await manager.update(
        Job,
        { id: jobId },
        {
          status: JobStatus.CANCELLED,
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
        },
      );
      await this.onTerminal(manager, jobId);
      return JobStatus.CANCELLED;
    });
  }

  /** Confirm a cancellation the runner has observed and acted on. */
  async confirmCancelled(jobId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.closeExecution(manager, jobId, JobExecutionStatus.CANCELLED);
      await manager.update(
        Job,
        { id: jobId },
        {
          status: JobStatus.CANCELLED,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      );
      await this.onTerminal(manager, jobId);
    });
  }

  async isCancelRequested(jobId: string): Promise<boolean> {
    const job = await this.dataSource
      .getRepository(Job)
      .findOne({ where: { id: jobId }, select: ['cancelRequestedAt'] });
    return job?.cancelRequestedAt != null;
  }

  async pause(shopId: string, jobId: string): Promise<void> {
    await this.dataSource.getRepository(Job).update(
      {
        id: jobId,
        shopId,
        status: In([JobStatus.PENDING, JobStatus.BLOCKED]),
      },
      { status: JobStatus.PAUSED, pausedAt: new Date() },
    );
  }

  async resume(shopId: string, jobId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const job = await manager.findOneOrFail(Job, {
        where: { id: jobId, shopId, status: JobStatus.PAUSED },
      });
      await manager.update(
        Job,
        { id: job.id },
        { status: JobStatus.PENDING, pausedAt: null, nextRunAt: null },
      );
      // It may have been paused before its dependencies finished.
      await this.releaseIfUnblocked(manager, job.id, true);
    });
  }

  // -------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------

  /**
   * Park a job on a Shopify bulk operation and let go of the worker.
   *
   * The lock is released deliberately. A bulk operation over 40,000 variants
   * runs for minutes; holding a worker (and the shop's concurrency key) for
   * the duration would idle the pool and block every other job for that shop
   * while nothing is happening. WAITING_BULK is not claimable, so the job stays
   * out of the dispatcher's way until the operation finishes.
   */
  async parkOnBulkOperation(
    jobId: string,
    bulkOperationId: string,
  ): Promise<void> {
    await this.dataSource.getRepository(Job).update(
      { id: jobId },
      {
        status: JobStatus.WAITING_BULK,
        bulkOperationId,
        lockedAt: null,
        lockedBy: null,
      },
    );
  }

  /**
   * Detach a job from a bulk operation whose results have been dealt with.
   *
   * Without this a job submitting several chunks would find the previous
   * operation still attached and read its results again on every pass.
   */
  async clearBulkOperation(jobId: string): Promise<void> {
    await this.dataSource
      .getRepository(Job)
      .update({ id: jobId }, { bulkOperationId: null });
  }

  /**
   * Wake a job parked on a bulk operation that has now finished.
   *
   * Fired for **every** terminal status, not only COMPLETED. A job whose bulk
   * operation failed or expired still has to run again to record that and give
   * up honestly; leaving it WAITING_BULK would strand it forever, since nothing
   * else will ever notify it.
   *
   * The attempt is not consumed: waiting on Shopify is not a failed try.
   */
  async resumeFromBulkOperation(bulkOperationId: string): Promise<Job | null> {
    const job = await this.dataSource.getRepository(Job).findOne({
      where: { bulkOperationId, status: JobStatus.WAITING_BULK },
    });
    if (!job) return null;

    await this.dataSource.getRepository(Job).update(
      { id: job.id },
      {
        status: JobStatus.PENDING,
        nextRunAt: null,
        attempts: () => '"attempts" - 1',
      },
    );
    this.logger.log(
      `Job ${job.id} resumed after bulk operation ${bulkOperationId} finished`,
    );
    return job;
  }

  /**
   * Mark the in-flight execution superseded, without deleting it.
   *
   * Used when a merchant edits a campaign that is mid-run. The row stays
   * because it is the only record of what had already reached Shopify, and
   * revert replays that record rather than the campaign's configuration.
   */
  async supersede(jobId: string): Promise<void> {
    const execution = await this.currentExecution(jobId);
    if (!execution) return;
    await this.dataSource
      .getRepository(JobExecution)
      .update({ id: execution.id }, { obsolete: true });
  }

  // -------------------------------------------------------------------
  // Children and dependencies
  // -------------------------------------------------------------------

  /**
   * Hand the remaining work to child jobs.
   *
   * The parent resolves targets, then spawns one child per batch so each
   * batch fits Shopify's rate limit on its own and can retry alone instead of
   * re-running the whole campaign.
   */
  async spawnChildren(
    shopId: string,
    parentJobId: string,
    specs: EnqueueJobSpec[],
  ): Promise<Job[]> {
    const children: Job[] = [];
    for (const spec of specs) {
      children.push(await this.enqueue(shopId, { ...spec, parentJobId }));
    }

    await this.dataSource.getRepository(Job).update(
      { id: parentJobId },
      {
        status: JobStatus.WAITING_CHILDREN,
        lockedAt: null,
        lockedBy: null,
        totalCount: children.length,
      },
    );
    return children;
  }

  /** Everything that must happen once a job reaches a terminal state. */
  private async onTerminal(
    manager: EntityManager,
    jobId: string,
  ): Promise<void> {
    await this.releaseDependents(manager, jobId);
    await this.settleParentIfDone(manager, jobId);
  }

  /**
   * Release jobs waiting on this one.
   *
   * Fired on success *and* on failure: the graph exists to order work, not to
   * gate it on success, so a failed first edit must not strand the second one
   * in the queue forever.
   */
  private async releaseDependents(
    manager: EntityManager,
    jobId: string,
  ): Promise<void> {
    const dependents: { job_id: string }[] = await manager.query(
      `SELECT "job_id" FROM "job_dependencies" WHERE "depends_on_job_id" = $1`,
      [jobId],
    );
    for (const dependent of dependents) {
      await this.releaseIfUnblocked(manager, dependent.job_id);
    }
  }

  /** Move a BLOCKED job to PENDING once every dependency is terminal. */
  private async releaseIfUnblocked(
    manager: EntityManager,
    jobId: string,
    force = false,
  ): Promise<void> {
    const job = await manager.findOne(Job, { where: { id: jobId } });
    if (!job) return;
    if (!force && job.status !== JobStatus.BLOCKED) return;

    const [{ outstanding }]: { outstanding: string }[] = await manager.query(
      `
      SELECT count(*)::text AS outstanding
        FROM "job_dependencies" d
        JOIN "jobs" j ON j."id" = d."depends_on_job_id"
       WHERE d."job_id" = $1
         AND j."status" <> ALL($2::"public"."jobs_status_enum"[])
      `,
      [jobId, TERMINAL_JOB_STATUSES],
    );

    if (Number(outstanding) === 0 && job.status === JobStatus.BLOCKED) {
      await manager.update(Job, { id: jobId }, { status: JobStatus.PENDING });
    }
  }

  /** Finish a parent once every child has settled. */
  private async settleParentIfDone(
    manager: EntityManager,
    childJobId: string,
  ): Promise<void> {
    const child = await manager.findOne(Job, { where: { id: childJobId } });
    if (!child?.parentJobId) return;

    const siblings = await manager.find(Job, {
      where: { parentJobId: child.parentJobId },
    });
    if (!siblings.every((sibling) => isTerminalJobStatus(sibling.status))) {
      return;
    }

    const failed = siblings.filter(
      (sibling) => sibling.status === JobStatus.FAILED,
    );

    await manager.update(
      Job,
      { id: child.parentJobId },
      failed.length > 0
        ? {
            status: JobStatus.FAILED,
            lastError: `${failed.length} of ${siblings.length} child job(s) failed`,
            failedCount: failed.length,
            processedCount: siblings.length - failed.length,
            finishedAt: new Date(),
          }
        : {
            status: JobStatus.SUCCEEDED,
            processedCount: siblings.length,
            finishedAt: new Date(),
          },
    );

    // The parent is itself terminal now, so its own dependents and parent
    // must settle too.
    await this.onTerminal(manager, child.parentJobId);
  }

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  async findById(shopId: string, jobId: string): Promise<Job | null> {
    return this.dataSource
      .getRepository(Job)
      .findOne({ where: { id: jobId, shopId } });
  }

  /** Due jobs, for observability — the dispatcher uses `claimNext`. */
  async countDue(): Promise<number> {
    return this.dataSource.getRepository(Job).count({
      where: [
        { status: JobStatus.PENDING, nextRunAt: IsNull() },
        { status: JobStatus.PENDING, nextRunAt: LessThanOrEqual(new Date()) },
      ],
    });
  }

  /** Release this worker's claims so a restart does not wait for the timeout. */
  async releaseClaims(workerId: string): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(Job)
      .set({
        status: JobStatus.PENDING,
        lockedAt: null,
        lockedBy: null,
        attempts: () => '"attempts" - 1',
      })
      .where('status = :status AND locked_by = :workerId', {
        status: JobStatus.RUNNING,
        workerId,
      })
      .execute();
    return result.affected ?? 0;
  }
}

/** Internal signal: another worker took the concurrency key first. */
class ClaimRaceError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
