import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SupplierRecordSource {
  CSV_IMPORT = 'CSV_IMPORT',
  API = 'API',
  MANUAL = 'MANUAL',
}

/**
 * One supplier-provided cost record (db #16-17, domain-model #9). Rows are
 * never overwritten in place — a new cost for the same SKU is a new row, so
 * supplier cost history is preserved via the import trail rather than a
 * dedicated history table (MVP scope per db #17).
 */
@Entity('supplier_records')
@Index(['shopId', 'sku'])
export class SupplierRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Index()
  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string;

  @Column({ type: 'varchar' })
  sku!: string;

  @Column({ name: 'external_product_id', type: 'varchar', nullable: true })
  externalProductId!: string | null;

  /** See common/entities/README.md — numeric, never a JS number. */
  @Column({ type: 'numeric', precision: 19, scale: 4 })
  cost!: string;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({ name: 'available_quantity', type: 'integer', nullable: true })
  availableQuantity!: number | null;

  @Column({
    type: 'enum',
    enum: SupplierRecordSource,
    default: SupplierRecordSource.CSV_IMPORT,
  })
  source!: SupplierRecordSource;

  /** e.g. the originating Import id, when source = CSV_IMPORT. */
  @Column({ name: 'source_reference', type: 'varchar', nullable: true })
  sourceReference!: string | null;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
