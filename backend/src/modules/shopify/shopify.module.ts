import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../common/auth/auth.module';
import { ShopsModule } from '../shops/shops.module';
import { BulkOperationService } from './services/bulk-operation.service';
import { CatalogController } from './controllers/catalog.controller';
import { BulkOperation } from './entities/bulk-operation.entity';
import { ShopifyResponseCache } from './response-cache';
import { ShopifyAdminService } from './services/shopify-admin.service';
import { ShopifyGraphQlClient } from './shopify-graphql.client';
import { ThrottleRegistry } from './throttle';
import { ShopifyClientFactory } from './shopify-client';
import { WebhookRegistrarService } from './services/webhook-registrar.service';

/**
 * The Shopify adapter layer.
 *
 * `ShopifyAdminService` is the only export that other modules should use — the
 * client, throttle and cache are its internals. Per the constitution nothing
 * outside this module talks to the Admin API, which is what keeps rate
 * limiting and error translation in one enforceable place.
 */
@Module({
  imports: [ShopsModule, AuthModule, TypeOrmModule.forFeature([BulkOperation])],
  controllers: [CatalogController],
  providers: [
    ShopifyAdminService,
    BulkOperationService,
    ShopifyGraphQlClient,
    ShopifyResponseCache,
    ThrottleRegistry,
    ShopifyClientFactory,
    WebhookRegistrarService,
  ],
  exports: [
    TypeOrmModule,
    ShopifyAdminService,
    BulkOperationService,
    ShopifyResponseCache,
    ShopifyClientFactory,
    WebhookRegistrarService,
  ],
})
export class ShopifyModule {}
