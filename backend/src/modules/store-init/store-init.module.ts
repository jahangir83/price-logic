import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ShopsModule } from '../shops/shops.module';
import { StoreInitController } from './controllers/store-init.controller';
import { StoreInitService } from './services/store-init.service';

@Module({
  imports: [AuthModule, ShopsModule],
  controllers: [StoreInitController],
  providers: [StoreInitService],
  exports: [StoreInitService],
})
export class StoreInitModule {}
