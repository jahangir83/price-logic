import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum PriceHistorySource {
  MANUAL = 'MANUAL',
  RULE = 'RULE',
  SUPPLIER_REPRICING = 'SUPPLIER_REPRICING',
  CAMPAIGN = 'CAMPAIGN',
  ROLLBACK = 'ROLLBACK',
  SCHEDULED = 'SCHEDULED',
}

/**
 * Append-only historical timeline of successful price changes
 * (domain-model #17-18, db #30-31). Rows are never updated — a variant
 * going $100→$120 then $120→$135 produces two rows, not one row mutated
 * twice. No `updated_at`/`deleted_at` by design.
 */
@Entity('price_history')
@Index(['shopId', 'variantId'])
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Index()
  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  @Index()
  @Column({ name: 'operation_id', type: 'uuid' })
  operationId!: string;

  /** See common/entities/README.md — numeric fields, never JS numbers. */
  @Column({
    name: 'previous_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
  })
  previousPrice!: string;

  @Column({ name: 'new_price', type: 'numeric', precision: 19, scale: 4 })
  newPrice!: string;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: PriceHistorySource,
  })
  source!: PriceHistorySource;

  @Index()
  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;
}
