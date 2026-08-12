import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ShopStatus {
  ACTIVE = 'ACTIVE',
  DISCONNECTED = 'DISCONNECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum InitializationStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
}

/**
 * The tenant root. Every merchant-owned table in this app must carry a
 * shopId foreign key back to this table — see common/tenant/ for the
 * enforcement pattern.
 */
@Entity('shops')
export class Shop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'shopify_shop_id', type: 'varchar' })
  shopifyShopId!: string;

  @Index({ unique: true })
  @Column({ name: 'shop_domain', type: 'varchar' })
  shopDomain!: string;

  /** AES-256-GCM ciphertext (see EncryptionService) — never the raw token. */
  @Column({ name: 'access_token_encrypted', type: 'text' })
  accessTokenEncrypted!: string;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar', default: 'UTC' })
  timezone!: string;

  @Column({
    type: 'enum',
    enum: ShopStatus,
    default: ShopStatus.ACTIVE,
  })
  status!: ShopStatus;

  @Column({
    name: 'initialization_status',
    type: 'enum',
    enum: InitializationStatus,
    default: InitializationStatus.NOT_STARTED,
  })
  initializationStatus!: InitializationStatus;

  /**
   * Merchant-editable defaults collected during the setup wizard. The
   * pricing engine (Phase 4/5) reads these; kept as a loose JSON bag here
   * since the concrete pricing-rule shape is defined in a later phase.
   */
  @Column({ name: 'default_settings', type: 'jsonb', default: {} })
  defaultSettings!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
