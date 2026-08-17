import {
  PriceChangeStatus,
  type Money,
  type PriceChange as PriceChangeModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export { PriceChangeStatus };

/**
 * What we changed on one variant, and what to put back.
 *
 * Deliberately self-contained: revert reads a single row and writes
 * `oldPrice` and `oldCompareAtPrice` back to Shopify. No join, no history
 * table, no snapshot. Restoring *both* columns is what makes "a product that
 * was already on sale gets its previous sale price back" work.
 *
 * Rows are never deleted, so this table is also the price history.
 *
 * The Shopify ids are plain strings with no foreign key — the catalog is
 * never mirrored into this database, so there is nothing to point at. Titles
 * are cached at write time so the results screen renders without a Shopify
 * call.
 *
 * Uniqueness is `(job_id, shopify_variant_id)`, **not** `(campaign_id, …)`.
 * Within one execution a variant is touched exactly once, so a retried
 * activation is rejected by the database rather than silently applying the
 * change twice — the same retry guard as before. Across executions the rows
 * accumulate, which is what lets a campaign run, revert and run again without
 * the second run overwriting the price the first one would need to restore.
 * Keying on the campaign allowed exactly one row per variant forever, and
 * quietly destroyed that price on the second activation.
 */
@Entity('price_changes')
@Index(['jobId', 'shopifyVariantId'], { unique: true })
@Index(['shopId', 'jobId'])
@Index(['shopId', 'campaignId'])
@Index(['shopId', 'status'])
export class PriceChange implements PriceChangeModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  /** Never null — every price change belongs to exactly one campaign. */
  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  /** The execution that wrote this row — see the uniqueness note above. */
  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ name: 'shopify_product_id', type: 'varchar' })
  shopifyProductId!: string;

  @Column({ name: 'shopify_variant_id', type: 'varchar' })
  shopifyVariantId!: string;

  @Column({ name: 'product_title', type: 'varchar' })
  productTitle!: string;

  @Column({ name: 'variant_title', type: 'varchar', nullable: true })
  variantTitle!: string | null;

  /** `Money` is a decimal string — see common/entities/README.md. */
  @Column({ name: 'old_price', type: 'numeric', precision: 19, scale: 4 })
  oldPrice!: Money;

  @Column({
    name: 'old_compare_at_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  oldCompareAtPrice!: Money | null;

  @Column({ name: 'new_price', type: 'numeric', precision: 19, scale: 4 })
  newPrice!: Money;

  @Column({
    name: 'new_compare_at_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  newCompareAtPrice!: Money | null;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: PriceChangeStatus,
    default: PriceChangeStatus.PENDING,
  })
  status!: PriceChangeStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @Column({ name: 'reverted_at', type: 'timestamptz', nullable: true })
  revertedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
