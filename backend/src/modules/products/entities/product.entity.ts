import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProductStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  DRAFT = 'DRAFT',
}

/**
 * Local mirror of a Shopify product (db #10-11). Only the fields needed for
 * pricing/matching are persisted — Shopify remains the source of truth for
 * full catalog data (db #47).
 */
@Entity('products')
@Index(['shopId', 'shopifyProductId'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'shopify_product_id', type: 'varchar' })
  shopifyProductId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status!: ProductStatus;

  @Column({ type: 'varchar', nullable: true })
  vendor!: string | null;

  @Column({ name: 'product_type', type: 'varchar', nullable: true })
  productType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  handle!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt!: Date | null;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
