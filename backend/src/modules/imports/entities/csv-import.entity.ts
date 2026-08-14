import {
  CsvImportStatus,
  type CsvImport as CsvImportModel,
} from '@pricelogic/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export { CsvImportStatus };

/**
 * One uploaded supplier sheet.
 *
 * Staging, not a durable parent: approving an import creates a campaign, and
 * from that point the campaign owns the outcome. `price_changes` never points
 * here — it always points at a campaign.
 *
 * The sheet carries **final prices**, not costs. There is no margin or markup
 * calculation; the campaign's own adjustment (if any) applies on top of
 * `csv_rows.sheet_price`.
 */
@Entity('csv_imports')
@Unique(['shopId', 'id'])
@Index(['shopId', 'createdAt'])
export class CsvImport implements CsvImportModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Index()
  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string;

  @Column({ name: 'file_name', type: 'varchar' })
  fileName!: string;

  @Index()
  @Column({
    type: 'enum',
    enum: CsvImportStatus,
    default: CsvImportStatus.UPLOADED,
  })
  status!: CsvImportStatus;

  @Column({ name: 'total_rows', type: 'integer', default: 0 })
  totalRows!: number;

  @Column({ name: 'valid_rows', type: 'integer', default: 0 })
  validRows!: number;

  @Column({ name: 'invalid_rows', type: 'integer', default: 0 })
  invalidRows!: number;

  /** Rows whose SKU resolved to exactly one Shopify variant. */
  @Column({ name: 'matched_rows', type: 'integer', default: 0 })
  matchedRows!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
