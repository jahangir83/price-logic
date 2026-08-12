import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ImportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum ImportFileType {
  CSV = 'CSV',
}

/** One supplier CSV import run (db #18-20, domain-model #24). */
@Entity('imports')
@Index(['shopId', 'createdAt'])
export class Import {
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

  @Column({
    name: 'file_type',
    type: 'enum',
    enum: ImportFileType,
    default: ImportFileType.CSV,
  })
  fileType!: ImportFileType;

  @Index()
  @Column({
    type: 'enum',
    enum: ImportStatus,
    default: ImportStatus.PENDING,
  })
  status!: ImportStatus;

  @Column({ name: 'total_rows', type: 'integer', default: 0 })
  totalRows!: number;

  @Column({ name: 'valid_rows', type: 'integer', default: 0 })
  validRows!: number;

  @Column({ name: 'invalid_rows', type: 'integer', default: 0 })
  invalidRows!: number;

  @Column({ name: 'matched_rows', type: 'integer', default: 0 })
  matchedRows!: number;

  @Column({ name: 'unmatched_rows', type: 'integer', default: 0 })
  unmatchedRows!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
