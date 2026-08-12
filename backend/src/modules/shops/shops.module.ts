import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { Shop } from './entities/shop.entity';
import { ShopsService } from './shops.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shop]), CryptoModule],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
