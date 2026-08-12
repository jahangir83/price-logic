import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PricingOperationType {
  MANUAL_PRICE_CHANGE = 'MANUAL_PRICE_CHANGE',
  RULE_EXECUTION = 'RULE_EXECUTION',
  SUPPLIER_REPRICING = 'SUPPLIER_REPRICING',
  CAMPAIGN_START = 'CAMPAIGN_START',
  CAMPAIGN_END = 'CAMPAIGN_END',
  ROLLBACK = 'ROLLBACK',
  SCHEDULED_OPERATION = 'SCHEDULED_OPERATION',
}

/**
 * Lifecycle order matters: valid forward transitions are exactly adjacent
 * pairs in this list, plus a transition from any non-terminal state to
 * FAILED or CANCELLED. The application layer (Phase 4/6) must enforce this
 * — the database only stores the current state (db #27).
 */
export enum PricingOperationStatus {
  DRAFT = 'DRAFT',
  PREVIEW = 'PREVIEW',
  APPROVED = 'APPROVED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** What triggered the operation, as distinct from what it does (operationType). */
export enum PricingOperationSource {
  MERCHANT = 'MERCHANT',
  SCHEDULER = 'SCHEDULER',
  SYSTEM = 'SYSTEM',
}

/**
 * One execution request against the pricing engine (domain-model #14-15).
 * `idempotencyKey` is unique per shop so a retried request can't apply the
 * same logical operation twice (db #42).
 */
@Entity('pricing_operations')
@Index(['shopId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
@Index(['shopId', 'createdAt'])
export class PricingOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({
    name: 'operation_type',
    type: 'enum',
    enum: PricingOperationType,
  })
  operationType!: PricingOperationType;

  @Index()
  @Column({
    type: 'enum',
    enum: PricingOperationStatus,
    default: PricingOperationStatus.DRAFT,
  })
  status!: PricingOperationStatus;

  @Column({
    type: 'enum',
    enum: PricingOperationSource,
    default: PricingOperationSource.MERCHANT,
  })
  source!: PricingOperationSource;

  @Column({ name: 'pricing_rule_id', type: 'uuid', nullable: true })
  pricingRuleId!: string | null;

  @Index()
  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'total_variants', type: 'integer', default: 0 })
  totalVariants!: number;

  @Column({ name: 'successful_variants', type: 'integer', default: 0 })
  successfulVariants!: number;

  @Column({ name: 'failed_variants', type: 'integer', default: 0 })
  failedVariants!: number;

  @Column({ name: 'skipped_variants', type: 'integer', default: 0 })
  skippedVariants!: number;

  /** Idempotency key for retried operation-creation requests (db #42). */
  @Column({ name: 'idempotency_key', type: 'varchar', nullable: true })
  idempotencyKey!: string | null;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
