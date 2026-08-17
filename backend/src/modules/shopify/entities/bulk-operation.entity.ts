import {
  BulkOperationKind,
  BulkOperationStatus,
  type BulkOperation as BulkOperationModel,
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

export { BulkOperationKind, BulkOperationStatus };

/**
 * A Shopify bulk operation this app started.
 *
 * The row exists because the operation outlives the request that created it.
 * Shopify accepts it, runs it on its own schedule and reports back minutes
 * later — possibly to a different worker, possibly after a deploy. Everything
 * needed to pick the thread back up is therefore on disk: which shop, which
 * job is parked on it, and Shopify's own id to poll.
 *
 * `shopify_bulk_operation_id` is unique because the `bulk_operations/finish`
 * webhook identifies an operation by that id alone, and a redelivery must find
 * the same row rather than create a second one.
 */
@Entity('bulk_operations')
@Unique(['shopifyBulkOperationId'])
@Index(['shopId', 'status'])
@Index(['jobId'])
export class BulkOperation implements BulkOperationModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  /** The job parked on this operation, woken when it finishes. */
  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  jobId!: string | null;

  @Column({ name: 'shopify_bulk_operation_id', type: 'varchar' })
  shopifyBulkOperationId!: string;

  @Column({ type: 'enum', enum: BulkOperationKind })
  kind!: BulkOperationKind;

  @Column({
    type: 'enum',
    enum: BulkOperationStatus,
    default: BulkOperationStatus.CREATED,
  })
  status!: BulkOperationStatus;

  /**
   * Signed JSONL result URL, valid for one week after completion.
   *
   * Stored for diagnosis, never as the plan for later work — a job downloads
   * its results during the run, because a URL read a week afterwards is a 403
   * and there is no way to ask for another.
   */
  @Column({ type: 'text', nullable: true })
  url!: string | null;

  /** What completed before a failure, when Shopify offers it. */
  @Column({ name: 'partial_data_url', type: 'text', nullable: true })
  partialDataUrl!: string | null;

  /** Shopify's code — `ACCESS_DENIED`, `TIMEOUT`, `INTERNAL_SERVER_ERROR`. */
  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode!: string | null;

  @Column({ name: 'object_count', type: 'integer', default: 0 })
  objectCount!: number;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
