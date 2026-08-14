import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { Shop } from './entities/shop.entity';
import { ShopsService } from './shops.service';
import { StoreStatusController } from './store-status.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Shop]), CryptoModule],
  controllers: [StoreStatusController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
