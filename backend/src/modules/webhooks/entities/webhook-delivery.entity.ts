import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * One webhook Shopify sent us.
 *
 * Exists for idempotency, not for audit. Shopify redelivers on any non-2xx, on
 * a timeout, and periodically of its own accord; the unique constraint on its
 * delivery id is what makes handling a webhook twice impossible rather than
 * merely unlikely.
 *
 * Not shop-scoped in the usual sense — `shop_id` is nullable because a
 * `shop/redact` for an already-deleted shop still arrives and still has to be
 * recorded as handled.
 */
@Entity('webhook_deliveries')
@Unique(['webhookId'])
@Index(['topic', 'createdAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Shopify's `X-Shopify-Webhook-Id`. */
  @Column({ name: 'webhook_id', type: 'varchar' })
  webhookId!: string;

  @Column({ type: 'varchar' })
  topic!: string;

  @Column({ name: 'shop_domain', type: 'varchar' })
  shopDomain!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid', nullable: true })
  shopId!: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  /** Null while in flight; set once the handler finished successfully. */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
