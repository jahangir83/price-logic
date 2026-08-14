import { Supplier as SupplierModel, SupplierStatus } from '@pricelogic/shared';
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

export { SupplierStatus };

/**
 * Who sent the sheet.
 *
 * Identity only — no costs, no supplier records, no integrations. It exists
 * so "where did this price come from?" stays answerable after the fact.
 * Soft-deleted rather than removed, because `csv_imports` references it and
 * import history must stay readable.
 *
 * The shape lives in `@pricelogic/shared`; this class adds only persistence.
 * `implements SupplierModel` is the guard rail: add a column here without
 * adding it to the shared model (or the reverse) and the build fails, so the
 * admin UI's type can never quietly drift from the table.
 */
@Entity('suppliers')
@Unique(['shopId', 'id'])
export class Supplier implements SupplierModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  /** Merchant shorthand. Not unique — two suppliers may share a code. */
  @Column({ type: 'varchar', nullable: true })
  code!: string | null;

  @Column({
    type: 'enum',
    enum: SupplierStatus,
    default: SupplierStatus.ACTIVE,
  })
  status!: SupplierStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
