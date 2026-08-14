import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobStatus, JobStep, JobType } from '@pricelogic/shared';
import { DataSource } from 'typeorm';
import { JobDependency } from '../src/modules/jobs/entities/job-dependency.entity';
import { JobExecution } from '../src/modules/jobs/entities/job-execution.entity';
import { Job } from '../src/modules/jobs/entities/job.entity';
import { JobDispatcherService } from '../src/modules/jobs/job-dispatcher.service';
import {
  JobContext,
  JobHandler,
  JobHandlerRegistry,
  PermanentJobError,
} from '../src/modules/jobs/job-handler';
import { JobsService } from '../src/modules/jobs/jobs.service';

/**
 * The job engine against a real PostgreSQL instance.
 *
 * Almost nothing here can be tested against a mock: `FOR UPDATE SKIP LOCKED`,
 * the partial unique index that enforces concurrency, and transaction
 * boundaries are the behaviour under test. A mocked repository would happily
 * confirm a design that deadlocks or double-applies in production.
 */
describe('job engine', () => {
  let moduleRef: TestingModule;
  let jobs: JobsService;
  let registry: JobHandlerRegistry;
  let dispatcher: JobDispatcherService;
  let dataSource: DataSource;

  const SHOP_A = '11111111-0000-4000-8000-000000000011';
  const SHOP_B = '22222222-0000-4000-8000-000000000022';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [Job, JobExecution, JobDependency],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([Job, JobExecution, JobDependency]),
      ],
      providers: [
        JobsService,
        JobHandlerRegistry,
        JobDispatcherService,
        {
          // The dispatcher must not poll on its own here — a background loop
          // racing an assertion about a PENDING job makes the suite flaky.
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'jobs.dispatcherEnabled' ? 'false' : undefined,
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    jobs = moduleRef.get(JobsService);
    registry = moduleRef.get(JobHandlerRegistry);
    dispatcher = moduleRef.get(JobDispatcherService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  /*
   * Clears every job, not just this suite's two shops.
   *
   * `claimNext` is deliberately global — the dispatcher serves all shops — so
   * a row left behind by another suite would be claimed here and the
   * assertions would depend on file order. jest-e2e runs with maxWorkers: 1
   * for the same reason: these suites share one database.
   */
  const cleanup = async () => {
    await dataSource.query(`DELETE FROM job_dependencies`);
    await dataSource.query(`DELETE FROM job_executions`);
    await dataSource.query(`DELETE FROM price_changes`);
    await dataSource.query(`DELETE FROM product_tag_changes`);
    await dataSource.query(`DELETE FROM jobs`);
    await dataSource.query(
      `DELETE FROM job_dependencies WHERE shop_id IN ($1, $2)`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(
      `DELETE FROM job_executions WHERE shop_id IN ($1, $2)`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(
      `DELETE FROM jobs WHERE shop_id IN ($1, $2) AND parent_job_id IS NOT NULL`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(`DELETE FROM jobs WHERE shop_id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
  };

  beforeEach(async () => {
    await cleanup();
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'eng-a', 'eng-a.myshopify.com', 'ciphertext'),
              ($2, 'eng-b', 'eng-b.myshopify.com', 'ciphertext')`,
      [SHOP_A, SHOP_B],
    );
    // The registry is a singleton across the suite; reset between tests.
    (
      registry as unknown as { handlers: Map<unknown, unknown> }
    ).handlers.clear();
  });

  const statusOf = async (jobId: string): Promise<JobStatus> => {
    const job = await dataSource
      .getRepository(Job)
      .findOneOrFail({ where: { id: jobId } });
    return job.status;
  };

  describe('enqueue', () => {
    it('creates a claimable job', async () => {
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      expect(job.status).toBe(JobStatus.PENDING);
      expect(job.attempts).toBe(0);
    });

    it('returns the existing job instead of creating a duplicate', async () => {
      // A double click must be indistinguishable from a single one.
      const first = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        dedupKey: 'activate:7',
      });
      const second = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        dedupKey: 'activate:7',
      });
      expect(second.id).toBe(first.id);
    });

    it('lets the same dedup key be used again once the first job is done', async () => {
      const first = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        dedupKey: 'activate:7',
      });
      await jobs.complete(first.id);
      const second = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        dedupKey: 'activate:7',
      });
      expect(second.id).not.toBe(first.id);
    });

    it('does not collapse the same key across different shops', async () => {
      const a = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        dedupKey: 'parse:1',
      });
      const b = await jobs.enqueue(SHOP_B, {
        type: JobType.CSV_PARSE,
        dedupKey: 'parse:1',
      });
      expect(b.id).not.toBe(a.id);
    });

    it('starts a dependent job BLOCKED, never claimable', async () => {
      const first = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      const second = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_MATCH,
        dependsOn: [first.id],
      });
      expect(second.status).toBe(JobStatus.BLOCKED);
    });

    it('releases immediately when the dependency already finished', async () => {
      const first = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await jobs.complete(first.id);
      const second = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_MATCH,
        dependsOn: [first.id],
      });
      expect(second.status).toBe(JobStatus.PENDING);
    });
  });

  describe('serialized enqueue', () => {
    it('chains three edits so they run in the order they were made', async () => {
      const first = await jobs.enqueueSerialized(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      const second = await jobs.enqueueSerialized(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      const third = await jobs.enqueueSerialized(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });

      expect(first.status).toBe(JobStatus.PENDING);
      expect(second.status).toBe(JobStatus.BLOCKED);
      expect(third.status).toBe(JobStatus.BLOCKED);

      // Only the head is claimable.
      const claimed = await jobs.claimNext('w1');
      expect(claimed?.id).toBe(first.id);
      expect(await jobs.claimNext('w2')).toBeNull();

      await jobs.complete(first.id);
      expect(await statusOf(second.id)).toBe(JobStatus.PENDING);
      expect(await statusOf(third.id)).toBe(JobStatus.BLOCKED);
    });

    it('releases the next edit even when the previous one failed', async () => {
      // Ordering, not success-gating: a failed first edit must not strand
      // the second one in the queue forever.
      const first = await jobs.enqueueSerialized(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      const second = await jobs.enqueueSerialized(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await jobs.claimNext('w1');
      await jobs.fail(first.id, 'boom', { retryable: false });

      expect(await statusOf(first.id)).toBe(JobStatus.FAILED);
      expect(await statusOf(second.id)).toBe(JobStatus.PENDING);
    });
  });

  describe('claiming', () => {
    it('opens an execution at the job type’s first step', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      const claimed = await jobs.claimNext('w1');
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.attempts).toBe(1);

      const execution = await jobs.currentExecution(job.id);
      expect(execution?.attempt).toBe(1);
      expect(execution?.step).toBe(JobStep.RESOLVE_TARGETS);
    });

    it('takes the highest priority first', async () => {
      await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE, priority: 0 });
      const urgent = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        priority: 10,
      });
      const claimed = await jobs.claimNext('w1');
      expect(claimed?.id).toBe(urgent.id);
    });

    it('does not claim a job scheduled for the future', async () => {
      await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        nextRunAt: new Date(Date.now() + 60_000),
      });
      expect(await jobs.claimNext('w1')).toBeNull();
    });

    it('holds back a second job sharing a concurrency key', async () => {
      const first = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        concurrencyKey: 'campaign-exec',
      });
      await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_REVERT,
        concurrencyKey: 'campaign-exec',
      });

      expect((await jobs.claimNext('w1'))?.id).toBe(first.id);
      expect(await jobs.claimNext('w2')).toBeNull();

      await jobs.complete(first.id);
      expect(await jobs.claimNext('w2')).not.toBeNull();
    });

    it('never lets one shop block another', async () => {
      await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        concurrencyKey: 'campaign-exec',
      });
      const other = await jobs.enqueue(SHOP_B, {
        type: JobType.CAMPAIGN_ACTIVATE,
        concurrencyKey: 'campaign-exec',
      });
      await jobs.claimNext('w1');
      expect((await jobs.claimNext('w2'))?.id).toBe(other.id);
    });

    it('hands the same job to only one of two concurrent workers', async () => {
      // The SKIP LOCKED guarantee, exercised concurrently rather than asserted.
      await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      const [a, b] = await Promise.all([
        jobs.claimNext('w1'),
        jobs.claimNext('w2'),
      ]);
      const claimed = [a, b].filter(Boolean);
      expect(claimed).toHaveLength(1);
    });
  });

  describe('lifecycle', () => {
    it('walks the step sequence for the job type', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_REVERT,
      });
      await jobs.claimNext('w1');

      expect((await jobs.currentExecution(job.id))?.step).toBe(
        JobStep.RESTORE_PRICES,
      );
      expect(await jobs.advanceToNextStep(job.id)).toBe(JobStep.RESTORE_TAGS);
      expect(await jobs.advanceToNextStep(job.id)).toBe(JobStep.FINALIZE);
      // Nothing follows the last step.
      expect(await jobs.advanceToNextStep(job.id)).toBeNull();
    });

    it('resets progress when the step changes', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await jobs.claimNext('w1');
      await jobs.recordProgress(job.id, { processed: 40, total: 100 });
      expect((await jobs.currentExecution(job.id))?.progress).toBe(40);

      await jobs.advanceToNextStep(job.id);
      expect((await jobs.currentExecution(job.id))?.progress).toBe(0);
    });

    it('closes the job and its execution on success', async () => {
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await jobs.claimNext('w1');
      await jobs.complete(job.id, { rows: 12 });

      const finished = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(finished.status).toBe(JobStatus.SUCCEEDED);
      expect(finished.finishedAt).not.toBeNull();
      expect(finished.lockedBy).toBeNull();
      expect((await jobs.currentExecution(job.id))?.result).toEqual({
        rows: 12,
      });
    });
  });

  describe('retry', () => {
    it('returns a failed job to the queue with a backoff', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        maxAttempts: 3,
      });
      await jobs.claimNext('w1');
      expect(await jobs.fail(job.id, 'network blip')).toBe(JobStatus.PENDING);

      const retried = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(retried.nextRunAt).not.toBeNull();
      // Backing off means not immediately claimable again.
      expect(await jobs.claimNext('w1')).toBeNull();
    });

    it('gives up once attempts are exhausted', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        maxAttempts: 2,
      });
      await jobs.claimNext('w1');
      await jobs.fail(job.id, 'once', {}, { baseMs: 0, jitter: 0 });
      await jobs.claimNext('w1');
      expect(await jobs.fail(job.id, 'twice')).toBe(JobStatus.FAILED);
    });

    it('never retries a plan-limit rejection', async () => {
      // The answer will not change on its own; retrying burns attempts and
      // tells the merchant nothing new.
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        maxAttempts: 10,
      });
      await jobs.claimNext('w1');
      const status = await jobs.fail(job.id, 'over limit', {
        code: 'PLAN_LIMIT_EXCEEDED',
        details: { limit: 50, required: 60 },
      });

      expect(status).toBe(JobStatus.FAILED);
      const failed = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(failed.errorCode).toBe('PLAN_LIMIT_EXCEEDED');
      expect(failed.errorDetails).toEqual({ limit: 50, required: 60 });
    });

    it('keeps every attempt as its own execution row', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        maxAttempts: 3,
      });
      await jobs.claimNext('w1');
      await jobs.fail(job.id, 'first', {}, { baseMs: 0, jitter: 0 });
      await jobs.claimNext('w1');
      await jobs.complete(job.id);

      const executions = await dataSource
        .getRepository(JobExecution)
        .find({ where: { jobId: job.id }, order: { attempt: 'ASC' } });
      expect(executions.map((e) => e.attempt)).toEqual([1, 2]);
    });
  });

  describe('cancel and pause', () => {
    it('cancels a queued job outright', async () => {
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      expect(await jobs.requestCancel(SHOP_A, job.id)).toBe(
        JobStatus.CANCELLED,
      );
    });

    it('only flags a running job, leaving it to stop itself', async () => {
      // Killing it mid-mutation would leave a half-applied campaign with no
      // record of what already reached Shopify.
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await jobs.claimNext('w1');

      expect(await jobs.requestCancel(SHOP_A, job.id)).toBe(JobStatus.RUNNING);
      expect(await jobs.isCancelRequested(job.id)).toBe(true);
      expect(await statusOf(job.id)).toBe(JobStatus.RUNNING);

      await jobs.confirmCancelled(job.id);
      expect(await statusOf(job.id)).toBe(JobStatus.CANCELLED);
    });

    it('refuses to cancel across shops', async () => {
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await expect(jobs.requestCancel(SHOP_B, job.id)).rejects.toThrow();
    });

    it('pauses and resumes', async () => {
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await jobs.pause(SHOP_A, job.id);
      expect(await statusOf(job.id)).toBe(JobStatus.PAUSED);
      expect(await jobs.claimNext('w1')).toBeNull();

      await jobs.resume(SHOP_A, job.id);
      expect(await jobs.claimNext('w1')).not.toBeNull();
    });

    it('releases dependents when a job is cancelled', async () => {
      const first = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      const second = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_MATCH,
        dependsOn: [first.id],
      });
      await jobs.requestCancel(SHOP_A, first.id);
      expect(await statusOf(second.id)).toBe(JobStatus.PENDING);
    });
  });

  describe('superseding', () => {
    it('keeps the obsolete execution as the record of what already ran', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await jobs.claimNext('w1');
      await jobs.supersede(job.id);

      const executions = await dataSource
        .getRepository(JobExecution)
        .find({ where: { jobId: job.id } });
      expect(executions).toHaveLength(1);
      expect(executions[0]?.obsolete).toBe(true);
      // It is no longer the current one.
      expect(await jobs.currentExecution(job.id)).toBeNull();
    });
  });

  describe('child jobs', () => {
    it('waits for every child before finishing', async () => {
      const parent = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await jobs.claimNext('w1');
      const children = await jobs.spawnChildren(SHOP_A, parent.id, [
        { type: JobType.CAMPAIGN_ACTIVATE },
        { type: JobType.CAMPAIGN_ACTIVATE },
      ]);

      expect(await statusOf(parent.id)).toBe(JobStatus.WAITING_CHILDREN);

      await jobs.complete(children[0].id);
      expect(await statusOf(parent.id)).toBe(JobStatus.WAITING_CHILDREN);

      await jobs.complete(children[1].id);
      expect(await statusOf(parent.id)).toBe(JobStatus.SUCCEEDED);
    });

    it('fails the parent when any child fails', async () => {
      const parent = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await jobs.claimNext('w1');
      const children = await jobs.spawnChildren(SHOP_A, parent.id, [
        { type: JobType.CAMPAIGN_ACTIVATE },
        { type: JobType.CAMPAIGN_ACTIVATE, maxAttempts: 1 },
      ]);

      await jobs.complete(children[0].id);
      await jobs.claimNext('w1');
      await jobs.fail(children[1].id, 'batch failed', { retryable: false });

      const settled = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: parent.id } });
      expect(settled.status).toBe(JobStatus.FAILED);
      expect(settled.failedCount).toBe(1);
    });

    it('releases the parent’s dependents once it settles', async () => {
      const parent = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      const after = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_REVERT,
        dependsOn: [parent.id],
      });
      await jobs.claimNext('w1');
      const children = await jobs.spawnChildren(SHOP_A, parent.id, [
        { type: JobType.CAMPAIGN_ACTIVATE },
      ]);

      expect(await statusOf(after.id)).toBe(JobStatus.BLOCKED);
      await jobs.complete(children[0].id);
      expect(await statusOf(after.id)).toBe(JobStatus.PENDING);
    });
  });

  describe('crash recovery', () => {
    it('returns a stale claim to the queue without charging an attempt', async () => {
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await jobs.claimNext('w1');
      await dataSource.query(
        `UPDATE jobs SET locked_at = now() - interval '1 hour' WHERE id = $1`,
        [job.id],
      );

      expect(await jobs.reclaimStale(60_000)).toBeGreaterThanOrEqual(1);
      const reclaimed = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(reclaimed.status).toBe(JobStatus.PENDING);
      // A few unlucky deploys must not retire a job.
      expect(reclaimed.attempts).toBe(0);
    });

    it('releases a worker’s claims on shutdown rather than waiting for the timeout', async () => {
      await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      const claimed = await jobs.claimNext('worker-going-away');
      expect(claimed).not.toBeNull();

      expect(await jobs.releaseClaims('worker-going-away')).toBe(1);
      expect(await statusOf(claimed!.id)).toBe(JobStatus.PENDING);
    });
  });

  describe('dispatcher', () => {
    const handlerFor = (
      type: JobType,
      run: (ctx: JobContext) => Promise<void>,
    ): JobHandler => ({ type, run });

    it('runs a registered handler and completes the job', async () => {
      const seen: string[] = [];
      registry.register(
        handlerFor(JobType.CSV_PARSE, async (ctx) => {
          seen.push(ctx.job.id);
          await ctx.report({ processed: 3, total: 3 });
        }),
      );

      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await dispatcher.tick();
      await dispatcher.drain();

      expect(seen).toEqual([job.id]);
      expect(await statusOf(job.id)).toBe(JobStatus.SUCCEEDED);
    });

    it('retries a handler that throws', async () => {
      registry.register(
        handlerFor(JobType.CSV_PARSE, () => {
          throw new Error('transient');
        }),
      );
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_PARSE,
        maxAttempts: 3,
      });
      await dispatcher.tick();
      await dispatcher.drain();

      const retried = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(retried.status).toBe(JobStatus.PENDING);
      expect(retried.lastError).toBe('transient');
    });

    it('does not retry a PermanentJobError', async () => {
      registry.register(
        handlerFor(JobType.CAMPAIGN_ACTIVATE, () => {
          throw new PermanentJobError('over limit', 'PLAN_LIMIT_EXCEEDED', {
            limit: 50,
          });
        }),
      );
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
        maxAttempts: 10,
      });
      await dispatcher.tick();
      await dispatcher.drain();

      const failed = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(failed.status).toBe(JobStatus.FAILED);
      expect(failed.errorCode).toBe('PLAN_LIMIT_EXCEEDED');
    });

    it('fails a job with no handler instead of retrying it forever', async () => {
      const job = await jobs.enqueue(SHOP_A, {
        type: JobType.CSV_MATCH,
        maxAttempts: 10,
      });
      await dispatcher.tick();
      await dispatcher.drain();

      const failed = await dataSource
        .getRepository(Job)
        .findOneOrFail({ where: { id: job.id } });
      expect(failed.status).toBe(JobStatus.FAILED);
      expect(failed.errorCode).toBe('NO_HANDLER');
    });

    it('leaves a job that spawned children for its children to finish', async () => {
      registry.register(
        handlerFor(JobType.CAMPAIGN_ACTIVATE, async (ctx) => {
          await ctx.spawnChildren([{ type: JobType.CAMPAIGN_ACTIVATE }]);
        }),
      );
      const parent = await jobs.enqueue(SHOP_A, {
        type: JobType.CAMPAIGN_ACTIVATE,
      });
      await dispatcher.tick();
      await dispatcher.drain();

      expect(await statusOf(parent.id)).toBe(JobStatus.WAITING_CHILDREN);
    });

    it('honours a cancellation the handler observed', async () => {
      registry.register(
        handlerFor(JobType.CSV_PARSE, async (ctx) => {
          await jobs.requestCancel(SHOP_A, ctx.job.id);
          // A real handler checks between batches; this is that check.
          if (await ctx.shouldStop()) return;
          throw new Error('should have stopped');
        }),
      );
      const job = await jobs.enqueue(SHOP_A, { type: JobType.CSV_PARSE });
      await dispatcher.tick();
      await dispatcher.drain();

      expect(await statusOf(job.id)).toBe(JobStatus.CANCELLED);
    });

    it('refuses two handlers for one job type', () => {
      const noop = handlerFor(JobType.CSV_PARSE, async () => {});
      registry.register(noop);
      expect(() => registry.register(noop)).toThrow(/already registered/);
    });
  });
});
