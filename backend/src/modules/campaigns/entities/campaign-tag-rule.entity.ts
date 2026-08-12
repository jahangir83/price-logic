import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum CampaignTagAction {
  /** Add the tag to in-scope products on activation; strip it on deactivation. */
  ADD = 'ADD',
  /** Strip the tag from in-scope products on activation; restore it on deactivation. */
  REMOVE = 'REMOVE',
}

/**
 * A tag the campaign mutates on its in-scope products while it is running.
 *
 * Not to be confused with `PricingRuleTarget` rows of type TAG — those
 * select WHICH products a rule applies to. These describe a side effect the
 * campaign performs ON those products in Shopify, and they are configuration
 * only: what was actually changed per product is recorded in
 * `campaign_tag_applications`, which is what deactivation reverses.
 */
@Entity('campaign_tag_rules')
@Unique(['campaignId', 'action', 'tag'])
@Index(['shopId', 'campaignId'])
export class CampaignTagRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @Column({ type: 'enum', enum: CampaignTagAction })
  action!: CampaignTagAction;

  @Column({ type: 'varchar' })
  tag!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
