import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  CampaignStatus,
  DuplicatePolicy,
  type Campaign as CampaignModel,
  type Money,
  type PriceEndingStrategy,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export {
  DuplicatePolicy,
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  CampaignStatus,
};

/**
 * The container every price change belongs to.
 *
 * There is deliberately no `campaignType` column. "Price increase" and "price
 * decrease" are a *direction*, and a supplier sheet is a *source* — they are
 * independent, which is what lets a sheet carry the merchant's own markup on
 * top of the supplier's price:
 *
 *   current price + 10%   →  price increase
 *   current price − 20%   →  sale
 *   sheet, no adjustment  →  supplier's prices as-is
 *   sheet + 15%           →  supplier's price plus markup
 *
 * `UNIQUE (shop_id, id)` exists so children can carry composite tenant
 * foreign keys — see the migration, not this file; the constraint cannot be
 * expressed through entity decorators.
 *
 * Enums and the field shape come from `@pricelogic/shared` so the admin UI
 * builds its form from the same definitions the database enforces.
 */
@Entity('campaigns')
@Unique(['shopId', 'id'])
@Index(['shopId', 'status'])
@Index(['shopId', 'startAt'])
@Index(['shopId', 'endAt'])
export class Campaign implements CampaignModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.DRAFT,
  })
  status!: CampaignStatus;

  @Column({
    name: 'price_source',
    type: 'enum',
    enum: CampaignPriceSource,
    default: CampaignPriceSource.SHOPIFY_CURRENT,
  })
  priceSource!: CampaignPriceSource;

  /** Set when `priceSource` is SHEET; null otherwise. */
  @Column({ name: 'csv_import_id', type: 'uuid', nullable: true })
  csvImportId!: string | null;

  /**
   * The adjustment is an all-or-nothing group: unit, direction and value are
   * either all set or all null. Null means "apply the base price unchanged",
   * which is what a plain supplier sheet does.
   */
  @Column({
    name: 'adjustment_unit',
    type: 'enum',
    enum: CampaignAdjustmentUnit,
    nullable: true,
  })
  adjustmentUnit!: CampaignAdjustmentUnit | null;

  @Column({
    name: 'adjustment_direction',
    type: 'enum',
    enum: CampaignAdjustmentDirection,
    nullable: true,
  })
  adjustmentDirection!: CampaignAdjustmentDirection | null;

  /** `Money` is a decimal string — see common/entities/README.md. */
  @Column({
    name: 'adjustment_value',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  adjustmentValue!: Money | null;

  @Column({
    type: 'enum',
    enum: CampaignBasis,
    default: CampaignBasis.PRICE,
  })
  basis!: CampaignBasis;

  /**
   * Charm-pricing ending, e.g. 0.99. **Null means the merchant turned
   * rounding off** — it is the on/off switch, not a missing value.
   */
  @Column({
    name: 'round_to',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  roundTo!: Money | null;

  /**
   * How a price is snapped onto `roundTo`; ignored when rounding is off.
   *
   * UP always moves to the next occurrence of the ending, so a 20% discount
   * landing on exactly 11.00 becomes 11.99 — it gives back most of the
   * discount. NEAREST would make that 10.99. UP is the default only because
   * it matches the behaviour this column was originally documented with.
   */
  @Column({
    name: 'round_strategy',
    type: 'enum',
    enum: ['UP', 'DOWN', 'NEAREST'],
    default: 'UP',
  })
  roundStrategy!: PriceEndingStrategy;

  /** Null means "use the shop's global setting". */
  @Column({
    name: 'duplicate_policy',
    type: 'enum',
    enum: DuplicatePolicy,
    nullable: true,
  })
  duplicatePolicy!: DuplicatePolicy | null;

  /**
   * When true, activation moves the old price into compare-at so the
   * storefront shows a strikethrough. Revert restores the *previous*
   * compare-at from the change row, so a product that was already on sale
   * gets its earlier sale price back rather than its full price.
   */
  @Column({ name: 'set_compare_at', type: 'boolean', default: false })
  setCompareAt!: boolean;

  @Column({
    name: 'include_mode',
    type: 'enum',
    enum: CampaignIncludeMode,
    default: CampaignIncludeMode.ALL_PRODUCTS,
  })
  includeMode!: CampaignIncludeMode;

  /** Blanket exclusion of non-published products, independent of target rows. */
  @Column({
    name: 'exclude_draft_archived',
    type: 'boolean',
    default: true,
  })
  excludeDraftArchived!: boolean;

  /**
   * Master switch for the EXCLUDE target rows. Turning it off suppresses
   * them without deleting the merchant's configured exclusion list.
   */
  @Column({ name: 'exclusions_enabled', type: 'boolean', default: false })
  exclusionsEnabled!: boolean;

  /** Tags added to in-scope products on activation, stripped on revert. */
  @Column({
    name: 'add_tags',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  addTags!: string[];

  /** Tags stripped from in-scope products on activation, restored on revert. */
  @Column({
    name: 'remove_tags',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  removeTags!: string[];

  @Column({ name: 'start_at', type: 'timestamptz', nullable: true })
  startAt!: Date | null;

  /**
   * IANA zone name, not an offset. `startAt` is the resolved instant; this
   * records the merchant's intent ("9am local") so the schedule survives a
   * DST boundary.
   */
  @Column({ name: 'start_timezone', type: 'varchar', default: 'UTC' })
  startTimezone!: string;

  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  @Column({ name: 'end_timezone', type: 'varchar', default: 'UTC' })
  endTimezone!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
