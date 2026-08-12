import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Variant } from './entities/variant.entity';

/**
 * Owns the local mirror of Shopify products/variants. Population (Phase 3
 * sync) and any controllers/services are added in later phases — this
 * module currently only registers the schema.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product, Variant])],
  exports: [TypeOrmModule],
})
export class ProductsModule {}
