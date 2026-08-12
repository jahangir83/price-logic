import { Module } from '@nestjs/common';
import { SessionModule } from '../../modules/session/session.module';
import { ShopsModule } from '../../modules/shops/shops.module';
import { SessionAuthGuard } from './session-auth.guard';
import { ShopGuard } from './shop.guard';

@Module({
  imports: [SessionModule, ShopsModule],
  providers: [SessionAuthGuard, ShopGuard],
  exports: [SessionAuthGuard, ShopGuard, SessionModule],
})
export class AuthModule {}
