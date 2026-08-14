import {
  CampaignTargetMode,
  CampaignTargetType,
  type CampaignTarget as CampaignTargetModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export { CampaignTargetMode, CampaignTargetType };

/**
 * One include or exclude target of a campaign.
 *
 * Targeting is a set, not a single scope: a campaign either covers all
 * products or a list of INCLUDE targets, and independently carries any number
 * of EXCLUDE targets. That makes "all products except these" directly
 * expressible, which a single scope pair cannot represent.
 *
 * Resolution rule (implemented by the target resolver, Phase 4): a variant is
 * in scope when it matches the include side and matches no EXCLUDE row.
 * **Exclusions always win.**
 *
 * Not used by SHEET campaigns — there the file's SKU list is the target.
 */
@Entity('campaign_targets')
@Unique(['campaignId', 'mode', 'targetType', 'targetValue'])
@Index(['shopId', 'campaignId'])
export class CampaignTarget implements CampaignTargetModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @Column({ type: 'enum', enum: CampaignTargetMode })
  mode!: CampaignTargetMode;

  @Column({ name: 'target_type', type: 'enum', enum: CampaignTargetType })
  targetType!: CampaignTargetType;

  /**
   * Meaning depends on `targetType`: a Shopify product/variant/collection id
   * for PRODUCT/VARIANT/COLLECTION, or the literal value for TAG, VENDOR and
   * PRODUCT_TYPE. Stored as text because those three are free-form strings,
   * so no foreign key is possible here.
   */
  @Column({ name: 'target_value', type: 'varchar' })
  targetValue!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
