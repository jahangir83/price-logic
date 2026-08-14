import {
  JobExecutionStatus,
  JobStep,
  type JobExecution as JobExecutionModel,
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
 * One attempt at a job.
 *
 * The job row says what should happen; this says what happened on try N —
 * which step it reached, how far it got, and what it produced. A retry writes
 * a new row rather than overwriting the last, so "what did attempt 1 do before
 * it died?" stays answerable. That question is asked precisely when a campaign
 * is half-applied, which is when guessing is most expensive.
 *
 * `obsolete` marks an execution superseded mid-flight — the merchant edited
 * the campaign while it was running. The row is **kept**: it is the only
 * record of what had already reached Shopify, and revert works from that
 * record rather than from the campaign's configuration.
 */
@Entity('job_executions')
@Unique(['jobId', 'attempt'])
@Index(['shopId', 'jobId'])
@Index(['jobId', 'status'])
export class JobExecution implements JobExecutionModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  /** 1-based. Unique per job, which is also the retry guard. */
  @Column({ type: 'integer' })
  attempt!: number;

  @Column({
    type: 'enum',
    enum: JobExecutionStatus,
    default: JobExecutionStatus.PENDING,
  })
  status!: JobExecutionStatus;

  /** Where this attempt got to. A resumed execution restarts from here. */
  @Column({ type: 'enum', enum: JobStep })
  step!: JobStep;

  /** Items processed within the current step, for the progress bar. */
  @Column({ type: 'integer', default: 0 })
  progress!: number;

  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  obsolete!: boolean;

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
