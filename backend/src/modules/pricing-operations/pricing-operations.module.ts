import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingOperation } from './entities/pricing-operation.entity';
import { PriceChange } from './entities/price-change.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PricingOperation, PriceChange])],
  exports: [TypeOrmModule],
})
export class PricingOperationsModule {}
