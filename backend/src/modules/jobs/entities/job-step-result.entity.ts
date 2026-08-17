import {
  JobExecutionStatus,
  JobStep,
  type JobStepResult as JobStepResultModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export { JobExecutionStatus, JobStep };

/**
 * What one step of a job produced.
 *
 * `job_executions.step` is a cursor — it says where an attempt got to. This is
 * the work itself: for each step, what it produced and whether it succeeded.
 * The difference shows up on a retry. Activation resolves 4,000 targets, prices
 * them, then fails pushing to Shopify; without this table the next attempt has
 * a `step` to resume from and nothing to resume *with*, so it re-resolves and
 * re-prices — and re-reading prices after some were already written is how
 * revert ends up restoring a number that was never on the storefront.
 *
 * One row per `(job_id, step)`, rewritten in place, with `tries` counting
 * re-entries. Per-attempt history stays in `job_executions`; this answers
 * "what did RESOLVE_TARGETS produce?" with exactly one row rather than one per
 * attempt.
 */
@Entity('job_step_results')
@Unique(['jobId', 'step'])
@Index(['shopId', 'jobId'])
export class JobStepResult implements JobStepResultModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ type: 'enum', enum: JobStep })
  step!: JobStep;

  @Column({
    type: 'enum',
    enum: JobExecutionStatus,
    default: JobExecutionStatus.PENDING,
  })
  status!: JobExecutionStatus;

  /** Re-entries across every attempt, not attempts of the job. */
  @Column({ type: 'integer', default: 0 })
  tries!: number;

  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
