import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SupplierRecord } from './entities/supplier-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, SupplierRecord])],
  exports: [TypeOrmModule],
})
export class SuppliersModule {}
