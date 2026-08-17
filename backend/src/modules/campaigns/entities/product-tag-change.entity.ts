import {
  ProductTagChangeStatus,
  type ProductTagChange as ProductTagChangeModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export { ProductTagChangeStatus };

/**
 * The tag mutation a campaign actually performed on one product.
 *
 * A row is written **only when the product's tag set genuinely changed** —
 * `resolveTagChange` in `@pricelogic/shared` decides that, and returns null
 * when there is nothing to record. If a product already carried a tag the
 * campaign wanted to add, no row is written, so deactivation leaves the
 * merchant's pre-existing tag alone.
 *
 * This is the constitution's rule in table form: never reverse a side effect
 * from configuration, reverse it from a record of what was actually done.
 * Deriving the undo from `campaigns.addTags` / `removeTags` would strip tags
 * the merchant set themselves that happened to match.
 *
 * Whole sets are stored rather than per-tag rows: `oldTags` is the complete
 * tag list before we touched the product, `newTags` the complete list we
 * wrote. Revert writes `oldTags` back verbatim.
 *
 * Tags are product-level in Shopify, while prices are variant-level — this is
 * the one table keyed on a product rather than a variant.
 */
@Entity('product_tag_changes')
@Index(['jobId', 'shopifyProductId'], { unique: true })
@Index(['shopId', 'jobId'])
@Index(['shopId', 'campaignId'])
export class ProductTagChange implements ProductTagChangeModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  /** The execution that wrote this row — see `PriceChange.jobId`. */
  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ name: 'shopify_product_id', type: 'varchar' })
  shopifyProductId!: string;

  /** The complete tag set before the campaign touched it. */
  @Column({ name: 'old_tags', type: 'text', array: true })
  oldTags!: string[];

  /** The complete tag set the campaign wrote. */
  @Column({ name: 'new_tags', type: 'text', array: true })
  newTags!: string[];

  @Column({
    type: 'enum',
    enum: ProductTagChangeStatus,
    default: ProductTagChangeStatus.PENDING,
  })
  status!: ProductTagChangeStatus;

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
