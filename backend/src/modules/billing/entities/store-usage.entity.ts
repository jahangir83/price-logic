import type { StoreUsage as StoreUsageModel } from '@pricelogic/shared';
import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cached usage, for the meter in the admin UI.
 *
 * Deliberately **not** the enforcement source. A denormalized counter always
 * drifts — a crashed worker, a manual database fix, a webhook processed twice
 * — which is what `lastReconciledAt` is admitting. The quota check at
 * activation recomputes from `price_changes` instead: it runs once per
 * activation, already holds the shop's concurrency lock, and is gating
 * revenue, so a stale number there is a refund rather than a slow page.
 *
 * Keyed on `shop_id` directly — one row per shop, no surrogate id.
 */
@Entity('store_usage')
export class StoreUsage implements StoreUsageModel {
  @PrimaryColumn({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  /** Distinct variants on sale across all active campaigns. */
  @Column({ name: 'active_variant_count', type: 'integer', default: 0 })
  activeVariantCount!: number;

  @Column({ name: 'active_campaign_count', type: 'integer', default: 0 })
  activeCampaignCount!: number;

  /** Null means never reconciled — treat the counts as untrusted. */
  @Index()
  @Column({ name: 'last_reconciled_at', type: 'timestamptz', nullable: true })
  lastReconciledAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
