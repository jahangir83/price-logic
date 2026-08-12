import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PricingRuleType {
  PERCENTAGE_MARKUP = 'PERCENTAGE_MARKUP',
  FIXED_MARKUP = 'FIXED_MARKUP',
  TARGET_MARGIN = 'TARGET_MARGIN',
  PERCENTAGE_INCREASE = 'PERCENTAGE_INCREASE',
  PERCENTAGE_DECREASE = 'PERCENTAGE_DECREASE',
  FIXED_INCREASE = 'FIXED_INCREASE',
  FIXED_DECREASE = 'FIXED_DECREASE',
}

export enum PricingRuleIncludeMode {
  /** Every product in the shop, minus whatever the EXCLUDE targets remove. */
  ALL_PRODUCTS = 'ALL_PRODUCTS',
  /** Only what the INCLUDE targets name, minus the EXCLUDE targets. */
  SPECIFIC = 'SPECIFIC',
}

export enum PricingRuleStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/**
 * Defines HOW a price should be calculated (domain-model #11-13) and, via
 * `pricing_rule_targets`, WHAT it applies to. The pricing engine (Phase 4)
 * is the only place that interprets `value` according to `ruleType` — this
 * table stores the definition only, never the calculation logic (db #24).
 */
@Entity('pricing_rules')
export class PricingRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({
    name: 'rule_type',
    type: 'enum',
    enum: PricingRuleType,
  })
  ruleType!: PricingRuleType;

  /** See common/entities/README.md — numeric, never a JS number. */
  @Column({ type: 'numeric', precision: 19, scale: 4 })
  value!: string;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  /**
   * Whether the rule starts from the whole catalog or from an explicit
   * include list. The include/exclude targets themselves live in
   * `pricing_rule_targets` — see PricingRuleTarget.
   */
  @Column({
    name: 'include_mode',
    type: 'enum',
    enum: PricingRuleIncludeMode,
    default: PricingRuleIncludeMode.ALL_PRODUCTS,
  })
  includeMode!: PricingRuleIncludeMode;

  /** Blanket exclusion of non-published products, independent of target rows. */
  @Column({
    name: 'exclude_draft_and_archived',
    type: 'boolean',
    default: false,
  })
  excludeDraftAndArchived!: boolean;

  /**
   * Master switch for the EXCLUDE target rows. Turning it off suppresses
   * them without deleting the merchant's configured exclusion list.
   */
  @Column({ name: 'exclusions_enabled', type: 'boolean', default: false })
  exclusionsEnabled!: boolean;

  @Column({
    name: 'minimum_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  minimumPrice!: string | null;

  @Column({
    name: 'maximum_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  maximumPrice!: string | null;

  @Column({
    name: 'minimum_margin',
    type: 'numeric',
    precision: 9,
    scale: 4,
    nullable: true,
  })
  minimumMargin!: string | null;

  @Column({
    type: 'enum',
    enum: PricingRuleStatus,
    default: PricingRuleStatus.ACTIVE,
  })
  status!: PricingRuleStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
