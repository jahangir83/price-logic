import {
  AppPlanHandle,
  type AppPlan as AppPlanModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export { AppPlanHandle };

/**
 * A plan and its caps.
 *
 * **Not shop-scoped** — the only table in this schema that isn't. It is
 * catalogue data, seeded by the migration and edited by us, not by merchants.
 *
 * The limits live here rather than as constants in `@pricelogic/shared`
 * because prices and caps change for commercial reasons that should not
 * require a deploy, and because a per-shop override (see the nullable columns
 * on `shops`) cannot be a constant. The shared package owns the handle enum;
 * the numbers come from this table.
 *
 * A null limit means unlimited — distinct from a null *override*, which means
 * "fall back to the plan".
 */
@Entity('app_plans')
export class AppPlan implements AppPlanModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'enum', enum: AppPlanHandle })
  handle!: AppPlanHandle;

  @Column({ type: 'varchar' })
  name!: string;

  /** Integer cents — never a float, and never a decimal we do maths on. */
  @Column({ name: 'price_cents', type: 'integer', default: 0 })
  priceCents!: number;

  @Column({ name: 'annual_price_cents', type: 'integer', nullable: true })
  annualPriceCents!: number | null;

  @Column({ name: 'trial_days', type: 'integer', default: 0 })
  trialDays!: number;

  /** Variants that may be on sale at once. Null = unlimited. */
  @Column({ name: 'active_variant_limit', type: 'integer', nullable: true })
  activeVariantLimit!: number | null;

  /** Campaigns that may be active at once. Null = unlimited. */
  @Column({ name: 'active_campaign_limit', type: 'integer', nullable: true })
  activeCampaignLimit!: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
