import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ImportRecordStatus {
  VALID = 'VALID',
  INVALID = 'INVALID',
  MATCHED = 'MATCHED',
  UNMATCHED = 'UNMATCHED',
  APPLIED = 'APPLIED',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

/** One row of an Import (db #18-20, domain-model #25). */
@Entity('import_records')
@Index(['shopId', 'importId'])
export class ImportRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'import_id', type: 'uuid' })
  importId!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'row_number', type: 'integer' })
  rowNumber!: number;

  /** The raw CSV row, kept for debugging/audit (db #19). */
  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData!: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  cost!: string | null;

  @Column({ type: 'varchar', nullable: true })
  currency!: string | null;

  @Column({ name: 'matched_variant_id', type: 'uuid', nullable: true })
  matchedVariantId!: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: ImportRecordStatus,
    default: ImportRecordStatus.VALID,
  })
  status!: ImportRecordStatus;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
