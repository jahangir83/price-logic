import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PriceChangeStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  SKIPPED = 'SKIPPED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CONFLICT = 'CONFLICT',
}

/**
 * The effect of one Pricing Operation on one Variant (domain-model #16).
 * `UNIQUE(operationId, variantId)` is both a domain constraint (an
 * operation only touches a given variant once) and the idempotency/conflict
 * guard for retried operation execution (db #28-29, #41-42) — a retry that
 * tries to insert the same (operation, variant) pair again is rejected by
 * the database rather than silently double-applying the change.
 */
@Entity('price_changes')
@Index(['operationId', 'variantId'], { unique: true })
export class PriceChange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Index()
  @Column({ name: 'operation_id', type: 'uuid' })
  operationId!: string;

  @Index()
  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  /** See common/entities/README.md — numeric fields, never JS numbers. */
  @Column({ name: 'previous_price', type: 'numeric', precision: 19, scale: 4 })
  previousPrice!: string;

  @Column({
    name: 'proposed_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
  })
  proposedPrice!: string;

  @Column({
    name: 'final_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  finalPrice!: string | null;

  @Column({
    name: 'previous_cost',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  previousCost!: string | null;

  @Column({
    name: 'current_cost',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  currentCost!: string | null;

  @Column({
    name: 'previous_margin',
    type: 'numeric',
    precision: 9,
    scale: 4,
    nullable: true,
  })
  previousMargin!: string | null;

  @Column({
    name: 'projected_margin',
    type: 'numeric',
    precision: 9,
    scale: 4,
    nullable: true,
  })
  projectedMargin!: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: PriceChangeStatus,
    default: PriceChangeStatus.PENDING,
  })
  status!: PriceChangeStatus;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
