import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum PricingRuleTargetMode {
  INCLUDE = 'INCLUDE',
  EXCLUDE = 'EXCLUDE',
}

export enum PricingRuleTargetType {
  PRODUCT = 'PRODUCT',
  COLLECTION = 'COLLECTION',
  VARIANT = 'VARIANT',
  TAG = 'TAG',
  VENDOR = 'VENDOR',
  PRODUCT_TYPE = 'PRODUCT_TYPE',
}

/**
 * One include or exclude target of a pricing rule.
 *
 * Targeting is a set, not a single scope: a rule either covers all products
 * or a list of INCLUDE targets, and independently carries any number of
 * EXCLUDE targets. That makes "all products except these" directly
 * expressible, which the previous single `scope_type`/`scope_reference`
 * pair could not represent.
 *
 * Resolution rule (enforced by the pricing engine, Phase 4): a variant is in
 * scope when it matches the include side and matches no EXCLUDE row.
 * Exclusions always win.
 */
@Entity('pricing_rule_targets')
@Unique(['pricingRuleId', 'mode', 'targetType', 'targetReference'])
@Index(['shopId', 'pricingRuleId'])
export class PricingRuleTarget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'pricing_rule_id', type: 'uuid' })
  pricingRuleId!: string;

  @Column({
    type: 'enum',
    enum: PricingRuleTargetMode,
  })
  mode!: PricingRuleTargetMode;

  @Column({
    name: 'target_type',
    type: 'enum',
    enum: PricingRuleTargetType,
  })
  targetType!: PricingRuleTargetType;

  /**
   * Internal Product/Variant id for PRODUCT/VARIANT, Shopify collection id
   * for COLLECTION, and the literal value for TAG/VENDOR/PRODUCT_TYPE —
   * meaning depends on `targetType`.
   */
  @Column({ name: 'target_reference', type: 'varchar' })
  targetReference!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
