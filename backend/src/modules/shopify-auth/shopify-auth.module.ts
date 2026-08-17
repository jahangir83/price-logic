import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { ShopsModule } from '../shops/shops.module';
import { StoreInitModule } from '../store-init/store-init.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { ShopifyAuthController } from './controllers/shopify-auth.controller';
import { ShopifyAuthService } from './services/shopify-auth.service';
import { ShopifyOAuthService } from './services/shopify-oauth.service';

@Module({
  imports: [SessionModule, ShopsModule, StoreInitModule, ShopifyModule],
  controllers: [ShopifyAuthController],
  providers: [ShopifyAuthService, ShopifyOAuthService],
})
export class ShopifyAuthModule {}
