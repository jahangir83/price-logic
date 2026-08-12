import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuditActorType {
  MERCHANT = 'MERCHANT',
  SYSTEM = 'SYSTEM',
  SCHEDULER = 'SCHEDULER',
  SHOPIFY_WEBHOOK = 'SHOPIFY_WEBHOOK',
}

export enum AuditAction {
  SHOP_CONNECTED = 'SHOP_CONNECTED',
  RULE_CREATED = 'RULE_CREATED',
  RULE_UPDATED = 'RULE_UPDATED',
  RULE_DELETED = 'RULE_DELETED',
  OPERATION_CREATED = 'OPERATION_CREATED',
  OPERATION_APPROVED = 'OPERATION_APPROVED',
  OPERATION_STARTED = 'OPERATION_STARTED',
  OPERATION_COMPLETED = 'OPERATION_COMPLETED',
  OPERATION_FAILED = 'OPERATION_FAILED',
  PRICE_UPDATED = 'PRICE_UPDATED',
  ROLLBACK_EXECUTED = 'ROLLBACK_EXECUTED',
  IMPORT_STARTED = 'IMPORT_STARTED',
  IMPORT_COMPLETED = 'IMPORT_COMPLETED',
  CAMPAIGN_STARTED = 'CAMPAIGN_STARTED',
  CAMPAIGN_COMPLETED = 'CAMPAIGN_COMPLETED',
}

export enum AuditEntityType {
  SHOP = 'SHOP',
  PRICING_RULE = 'PRICING_RULE',
  PRICING_OPERATION = 'PRICING_OPERATION',
  VARIANT = 'VARIANT',
  IMPORT = 'IMPORT',
  CAMPAIGN = 'CAMPAIGN',
}

/**
 * Append-only record of important application actions (db #35-36). No
 * `updated_at`/`deleted_at` by design — audit history must never be
 * mutated after the fact.
 */
@Entity('audit_logs')
@Index(['shopId', 'entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({
    name: 'actor_type',
    type: 'enum',
    enum: AuditActorType,
  })
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actorId!: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: AuditAction,
  })
  action!: AuditAction;

  @Column({
    name: 'entity_type',
    type: 'enum',
    enum: AuditEntityType,
  })
  entityType!: AuditEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
