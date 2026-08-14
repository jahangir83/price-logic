import {
  SubscriptionEventType,
  type StoreSubscriptionEvent as StoreSubscriptionEventModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export { SubscriptionEventType };

/**
 * Append-only billing history.
 *
 * Rows are never updated and never deleted. Merchants dispute charges, and
 * `store_subscriptions` holds only the present — it cannot answer "what plan
 * was I on when this was billed?". `fromPlanId`/`toPlanId` make an upgrade or
 * downgrade reconstructable without joining against a plan table that may
 * itself have changed since.
 *
 * There is no `updated_at` on purpose: a row that can be updated is not an
 * audit trail.
 */
@Entity('store_subscription_events')
@Index(['shopId', 'occurredAt'])
export class StoreSubscriptionEvent implements StoreSubscriptionEventModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  /** Null when the event outlives the subscription row it referred to. */
  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @Column({ type: 'enum', enum: SubscriptionEventType })
  type!: SubscriptionEventType;

  @Column({ name: 'from_plan_id', type: 'uuid', nullable: true })
  fromPlanId!: string | null;

  @Column({ name: 'to_plan_id', type: 'uuid', nullable: true })
  toPlanId!: string | null;

  /** The raw Shopify payload that triggered this, for reconciliation. */
  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt!: Date;
}
