import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CampaignTagAction } from './campaign-tag-rule.entity';

/**
 * A tag mutation this campaign actually performed on one product.
 *
 * Written only when the product's tag state genuinely changed — if a product
 * already carried a tag the campaign wanted to ADD, no row is written, so
 * deactivation leaves the merchant's pre-existing tag alone. Deactivation
 * reverses exactly the rows recorded here and nothing else, then stamps
 * `reverted_at`.
 *
 * Append-only in the same spirit as `price_history`: rows are never deleted
 * to reflect a later state, and a recurring campaign that runs again writes
 * a fresh row rather than reusing the reverted one. The partial unique index
 * on the un-reverted rows makes re-applying an already-active tag a no-op
 * instead of a duplicate.
 */
@Entity('campaign_tag_applications')
@Index(['campaignId', 'productId', 'tag', 'action'], {
  unique: true,
  where: '"reverted_at" IS NULL',
})
@Index(['shopId', 'campaignId'])
@Index(['shopId', 'productId'])
export class CampaignTagApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ type: 'varchar' })
  tag!: string;

  @Column({ type: 'enum', enum: CampaignTagAction })
  action!: CampaignTagAction;

  @Column({ name: 'applied_at', type: 'timestamptz' })
  appliedAt!: Date;

  /** Null while the mutation is still in effect on the product. */
  @Column({ name: 'reverted_at', type: 'timestamptz', nullable: true })
  revertedAt!: Date | null;
}
