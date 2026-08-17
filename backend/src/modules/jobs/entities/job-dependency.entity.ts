import type { JobDependency as JobDependencyModel } from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * One edge of the dependency graph: `jobId` waits for `dependsOnJobId`.
 *
 * A join table rather than an array column because both directions must be
 * cheap. The UI asks "what is this waiting for?" (`jobId`), and the dispatcher
 * asks the far more frequent "what does finishing this release?"
 * (`dependsOnJobId`) — the second would be a sequential scan against an array.
 *
 * Edges are **job → job, never campaign → campaign.** Ordering is a property
 * of a particular execution, not of configuration: creating or editing a
 * campaign enqueues a job that depends on the shop's most recent non-terminal
 * job, which is what makes three campaigns edited at once run strictly in the
 * order the merchant edited them.
 *
 * A dependency is satisfied when the parent reaches *any* terminal state —
 * succeeded, failed or cancelled. The purpose is ordering, not success-gating;
 * a failed first edit must not strand the second one in the queue forever.
 */
@Entity('job_dependencies')
@Index(['dependsOnJobId'])
@Index(['shopId'])
export class JobDependency implements JobDependencyModel {
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @PrimaryColumn({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @PrimaryColumn({ name: 'depends_on_job_id', type: 'uuid' })
  dependsOnJobId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
