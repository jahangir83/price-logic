import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum VariantStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

/**
 * The primary pricing unit (domain-model #6-7). Belongs to a Product, which
 * belongs to a Shop (domain-model #32). `version` supports optimistic
 * locking so two concurrent pricing operations can't blindly overwrite each
 * other's price update (db #41).
 */
@Entity('variants')
@Index(['shopId', 'shopifyVariantId'], { unique: true })
@Index(['shopId', 'sku'])
@Index(['shopId', 'productId'])
@Index(['shopId', 'status'])
export class Variant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'shopify_variant_id', type: 'varchar' })
  shopifyVariantId!: string;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({ type: 'varchar', nullable: true })
  barcode!: string | null;

  /** See common/entities/README.md — numeric, never a JS number. */
  @Column({ type: 'numeric', precision: 19, scale: 4 })
  price!: string;

  @Column({
    name: 'compare_at_price',
    type: 'numeric',
    precision: 19,
    scale: 4,
    nullable: true,
  })
  compareAtPrice!: string | null;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({ name: 'inventory_quantity', type: 'integer', default: 0 })
  inventoryQuantity!: number;

  @Column({
    type: 'enum',
    enum: VariantStatus,
    default: VariantStatus.ACTIVE,
  })
  status!: VariantStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt!: Date | null;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;

  @VersionColumn({ name: 'version' })
  version!: number;
}
