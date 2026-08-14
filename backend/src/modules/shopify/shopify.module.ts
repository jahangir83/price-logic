import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ShopsModule } from '../shops/shops.module';
import { CatalogController } from './catalog.controller';
import { ShopifyResponseCache } from './response-cache';
import { ShopifyAdminService } from './shopify-admin.service';
import { ShopifyGraphQlClient } from './shopify-graphql.client';
import { ThrottleRegistry } from './throttle';

/**
 * The Shopify adapter layer.
 *
 * `ShopifyAdminService` is the only export that other modules should use — the
 * client, throttle and cache are its internals. Per the constitution nothing
 * outside this module talks to the Admin API, which is what keeps rate
 * limiting and error translation in one enforceable place.
 */
@Module({
  imports: [ShopsModule, AuthModule],
  controllers: [CatalogController],
  providers: [
    ShopifyAdminService,
    ShopifyGraphQlClient,
    ShopifyResponseCache,
    ThrottleRegistry,
  ],
  exports: [ShopifyAdminService, ShopifyResponseCache],
})
export class ShopifyModule {}
