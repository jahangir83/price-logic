import { JobStatus, JobType, type Job as JobModel } from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export { JobStatus, JobType };

/**
 * The intent: what should happen, to what, under which constraints.
 *
 * A job is not a run. It is enqueued once and may be attempted many times —
 * each attempt is a `job_executions` row. Keeping them apart is what makes a
 * retried or resumed job legible instead of overwriting its own history.
 *
 * Three constraints on this table cannot be expressed through decorators and
 * live in the migration instead — read it, not this file, for the truth:
 *
 *   1. `UNIQUE (shop_id, id)`, so children can carry composite tenant keys.
 *   2. A **partial unique index** on `(shop_id, concurrency_key)` where the
 *      status is RUNNING. This is what enforces "campaign start and end run
 *      one at a time per shop" in the database rather than in application
 *      logic, and it is also what makes the plan-limit check race-free: two
 *      activations cannot both pass the quota check and then both apply.
 *   3. A **partial unique index** on `(shop_id, dedup_key)` over live
 *      statuses only, so a double click or a redelivered webhook collapses
 *      into one job while the same work stays legitimately repeatable later.
 */
@Entity('jobs')
@Unique(['shopId', 'id'])
@Index(['shopId', 'status'])
@Index(['shopId', 'campaignId'])
@Index(['status', 'nextRunAt'])
@Index(['parentJobId'])
export class Job implements JobModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ type: 'enum', enum: JobType })
  type!: JobType;

  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.PENDING })
  status!: JobStatus;

  /** Set when this job was spawned by another to handle one batch. */
  @Column({ name: 'parent_job_id', type: 'uuid', nullable: true })
  parentJobId!: string | null;

  /** At most one subject is set — enforced by a CHECK in the migration. */
  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId!: string | null;

  @Column({ name: 'csv_import_id', type: 'uuid', nullable: true })
  csvImportId!: string | null;

  /** Jobs sharing this key never run concurrently within a shop. */
  @Column({ name: 'concurrency_key', type: 'varchar', nullable: true })
  concurrencyKey!: string | null;

  /** Collapses a repeated request into one job while the job is live. */
  @Column({ name: 'dedup_key', type: 'varchar', nullable: true })
  dedupKey!: string | null;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  /** Null means retry forever. */
  @Column({ name: 'max_attempts', type: 'integer', nullable: true, default: 5 })
  maxAttempts!: number | null;

  /**
   * Earliest the job may be claimed. Carries scheduling and retry backoff in
   * one column — a campaign scheduled for 9am and a job backing off after a
   * throttle are the same question to the dispatcher.
   */
  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt!: Date | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  /** Worker identity, so a crashed worker's claims can be reclaimed. */
  @Column({ name: 'locked_by', type: 'varchar', nullable: true })
  lockedBy!: string | null;

  /**
   * Cancellation is cooperative: the runner checks this between steps and
   * between batches. A job is never killed mid-mutation, which would leave a
   * half-applied campaign with no record of what already reached Shopify.
   */
  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt!: Date | null;

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt!: Date | null;

  @Column({ name: 'total_count', type: 'integer', default: 0 })
  totalCount!: number;

  @Column({ name: 'processed_count', type: 'integer', default: 0 })
  processedCount!: number;

  @Column({ name: 'failed_count', type: 'integer', default: 0 })
  failedCount!: number;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  /** e.g. `PLAN_LIMIT_EXCEEDED` — the UI branches on this, not on a message. */
  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode!: string | null;

  /** Structured detail for the code, e.g. `{ limit, current, required }`. */
  @Column({ name: 'error_details', type: 'jsonb', nullable: true })
  errorDetails!: Record<string, unknown> | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
