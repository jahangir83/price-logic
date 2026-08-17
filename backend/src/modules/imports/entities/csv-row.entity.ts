import { MatchStrategy } from '@pricelogic/shared';
import {
  CsvRowStatus,
  type CsvRow as CsvRowModel,
  type Money,
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

export { CsvRowStatus };

/**
 * One row of an uploaded sheet, and the three numbers the approval form shows
 * side by side:
 *
 *   currentPrice   what the merchant charges now (fetched from Shopify)
 *   sheetPrice     what the supplier sent
 *   approvedPrice  what it becomes — pre-filled by the calculation pipeline,
 *                  editable by the merchant
 *
 * `sheetPrice` is the *base*, not the final answer: the campaign's adjustment
 * and rounding still apply on top of it. `approvedPrice` holds the result,
 * and any merchant override — which is validated server-side, since a
 * client-supplied price is never trusted for execution.
 *
 * A bad row never fails the file. Parsing marks it INVALID with a specific
 * message and continues, so the merchant sees exactly which lines to fix.
 */
@Entity('csv_rows')
@Unique(['csvImportId', 'rowNumber'])
@Index(['shopId', 'csvImportId'])
@Index(['csvImportId', 'status'])
export class CsvRow implements CsvRowModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'csv_import_id', type: 'uuid' })
  csvImportId!: string;

  @Column({ name: 'row_number', type: 'integer' })
  rowNumber!: number;

  /** The row exactly as uploaded, kept for debugging and merchant support. */
  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData!: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  /** `Money` is a decimal string — see common/entities/README.md. */
  @Column({
    name: 'sheet_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  sheetPrice!: Money | null;

  @Column({
    name: 'sheet_compare_at_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  sheetCompareAtPrice!: Money | null;

  /** Fetched from Shopify at match time, for the comparison column. */
  @Column({
    name: 'current_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  currentPrice!: Money | null;

  /** After adjustment + rounding; the merchant may override this. */
  @Column({
    name: 'approved_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  approvedPrice!: Money | null;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({ name: 'shopify_product_id', type: 'varchar', nullable: true })
  shopifyProductId!: string | null;

  @Column({ name: 'shopify_variant_id', type: 'varchar', nullable: true })
  shopifyVariantId!: string | null;

  /**
   * Copied from Shopify at match time, not looked up for display. A sheet
   * reviewed today may be approved next week, and a product renamed in between
   * must not turn the review into a list of codes.
   */
  @Column({ name: 'product_title', type: 'varchar', nullable: true })
  productTitle!: string | null;

  @Column({ name: 'variant_title', type: 'varchar', nullable: true })
  variantTitle!: string | null;

  /** What the supplier's sheet said. Null means it did not say. */
  @Column({ name: 'sheet_stock', type: 'integer', nullable: true })
  sheetStock!: number | null;

  /** The supplier's own code, when their sheet carries one. */
  @Column({ name: 'supplier_sku', type: 'varchar', nullable: true })
  supplierSku!: string | null;

  /** UPC / EAN / GTIN from the sheet, when it carries one. */
  @Column({ type: 'varchar', nullable: true })
  barcode!: string | null;

  /**
   * Which rung of the ladder found the variant, or null when none did.
   *
   * Varchar rather than an enum type: the list grows (manual mapping is next)
   * and each addition to a Postgres enum is a migration that locks the table.
   * `MatchStrategy` in the shared package is what constrains it.
   */
  @Column({ name: 'matched_by', type: 'varchar', nullable: true })
  matchedBy!: MatchStrategy | null;

  /**
   * What Shopify reported at match time. Shown to the merchant, but not what
   * the skip is decided on at activation — stock moves between review and run,
   * so activation re-reads it live.
   */
  @Column({ name: 'stock_quantity', type: 'integer', nullable: true })
  stockQuantity!: number | null;

  /** Merchant can drop a row from the campaign without deleting the record. */
  @Column({ type: 'boolean', default: false })
  excluded!: boolean;

  @Column({
    type: 'enum',
    enum: CsvRowStatus,
    default: CsvRowStatus.VALID,
  })
  status!: CsvRowStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
