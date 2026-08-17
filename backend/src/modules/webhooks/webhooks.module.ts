import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { JobsModule } from '../jobs/jobs.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { ShopsModule } from '../shops/shops.module';
import { BulkOperationCoordinator } from './services/bulk-operation-coordinator.service';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { ShopErasureService } from './services/shop-erasure.service';
import { WebhooksController } from './controllers/webhooks.controller';

@Module({
  imports: [
    ShopsModule,
    BillingModule,
    // The bulk-operation coordinator joins these two; neither knows about the
    // other, which is the point of it living here.
    JobsModule,
    ShopifyModule,
    TypeOrmModule.forFeature([WebhookDelivery]),
  ],
  controllers: [WebhooksController],
  providers: [ShopErasureService, BulkOperationCoordinator],
  exports: [ShopErasureService, BulkOperationCoordinator],
})
export class WebhooksModule {}
