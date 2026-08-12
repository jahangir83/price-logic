import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../common/auth/auth.module';
import { ShopsModule } from '../shops/shops.module';
import { Shop } from '../shops/entities/shop.entity';
import { StoreInitController } from './store-init.controller';
import { StoreInitService } from './store-init.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shop]), AuthModule, ShopsModule],
  controllers: [StoreInitController],
  providers: [StoreInitService],
  exports: [StoreInitService],
})
export class StoreInitModule {}
