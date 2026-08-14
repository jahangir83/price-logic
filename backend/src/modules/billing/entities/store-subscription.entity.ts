import {
  BillingInterval,
  SubscriptionStatus,
  type StoreSubscription as StoreSubscriptionModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export { BillingInterval, SubscriptionStatus };

/**
 * What a shop is currently paying for.
 *
 * One row per shop — a merchant has at most one active plan. History lives in
 * `store_subscription_events`, which is append-only, because this row is
 * overwritten on every upgrade and cannot answer "what was I on when this was
 * billed?".
 *
 * `shopifySubscriptionGid` is null between creating a charge and the merchant
 * confirming it in Shopify's UI; a PENDING row with no GID is the normal
 * intermediate state, not an error.
 */
@Entity('store_subscriptions')
@Unique(['shopId'])
@Index(['shopId', 'status'])
export class StoreSubscription implements StoreSubscriptionModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Index()
  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({
    name: 'billing_interval',
    type: 'enum',
    enum: BillingInterval,
    default: BillingInterval.MONTHLY,
  })
  billingInterval!: BillingInterval;

  /** Shopify's `AppSubscription` GID. Unique — one charge, one row. */
  @Index({ unique: true, where: '"shopify_subscription_gid" IS NOT NULL' })
  @Column({
    name: 'shopify_subscription_gid',
    type: 'varchar',
    nullable: true,
  })
  shopifySubscriptionGid!: string | null;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.PENDING,
  })
  status!: SubscriptionStatus;

  @Column({
    name: 'current_period_start_at',
    type: 'timestamptz',
    nullable: true,
  })
  currentPeriodStartAt!: Date | null;

  @Column({
    name: 'current_period_end_at',
    type: 'timestamptz',
    nullable: true,
  })
  currentPeriodEndAt!: Date | null;

  @Column({ name: 'trial_start_at', type: 'timestamptz', nullable: true })
  trialStartAt!: Date | null;

  @Column({ name: 'trial_end_at', type: 'timestamptz', nullable: true })
  trialEndAt!: Date | null;

  /**
   * Shopify could not collect payment but has not cancelled yet. The shop
   * keeps its entitlements for now — dropping a merchant to the Free plan
   * mid-campaign would deactivate live sales over a card that will retry.
   */
  @Column({ name: 'is_in_grace_period', type: 'boolean', default: false })
  isInGracePeriod!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
