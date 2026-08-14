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
 * `UNIQUE (campaign_id, shopify_variant_id)` is both a domain rule (a
 * campaign touches a variant once) and the retry guard: a re-run that tries
 * to insert the same pair is rejected by the database rather than silently
 * applying the change twice. A surrogate uuid primary key is used rather than
 * a concatenated `campaignId_variantId` key so a campaign can run, revert and
 * run again without colliding.
 */
@Entity('price_changes')
@Index(['campaignId', 'shopifyVariantId'], { unique: true })
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
