import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { ShopsModule } from '../shops/shops.module';
import { StoreInitModule } from '../store-init/store-init.module';
import { ShopifyAuthController } from './shopify-auth.controller';
import { ShopifyAuthService } from './shopify-auth.service';
import { ShopifyOAuthService } from './shopify-oauth.service';

@Module({
  imports: [SessionModule, ShopsModule, StoreInitModule],
  controllers: [ShopifyAuthController],
  providers: [ShopifyAuthService, ShopifyOAuthService],
})
export class ShopifyAuthModule {}
