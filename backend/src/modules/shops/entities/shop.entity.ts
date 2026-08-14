import {
  DEFAULT_DUPLICATE_POLICY,
  DuplicatePolicy,
  InitializationStatus,
  ShopStatus,
  type Shop as ShopModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export { DuplicatePolicy, InitializationStatus, ShopStatus };

/**
 * The tenant root. Every merchant-owned table in this app must carry a
 * shopId foreign key back to this table — see common/tenant/ for the
 * enforcement pattern.
 */
@Entity('shops')
export class Shop implements ShopModel {
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

  /**
   * The merchant's global setting for a variant claimed by two active
   * campaigns. A campaign may override it; null on the campaign means "use
   * this". Defaults to largest-discount-wins because that is the only
   * order-independent option — the right price stays recomputable from the
   * campaigns currently holding the variant, which is what makes revert work
   * when another campaign still owns it.
   */
  @Column({
    name: 'duplicate_policy',
    type: 'enum',
    enum: DuplicatePolicy,
    default: DEFAULT_DUPLICATE_POLICY,
  })
  duplicatePolicy!: DuplicatePolicy;

  /**
   * Per-shop plan-limit overrides for an enterprise deal, a support gesture
   * or a grandfathered merchant — the reason plan limits are data rather than
   * constants.
   *
   * Null means "use the plan's own limit", **not** unlimited. Unlimited is a
   * null limit on the plan itself.
   */
  @Column({
    name: 'override_active_variant_limit',
    type: 'integer',
    nullable: true,
  })
  overrideActiveVariantLimit!: number | null;

  @Column({
    name: 'override_active_campaign_limit',
    type: 'integer',
    nullable: true,
  })
  overrideActiveCampaignLimit!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
