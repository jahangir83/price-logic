import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { ShopsModule } from '../shops/shops.module';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { ShopErasureService } from './shop-erasure.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    ShopsModule,
    BillingModule,
    TypeOrmModule.forFeature([WebhookDelivery]),
  ],
  controllers: [WebhooksController],
  providers: [ShopErasureService],
  exports: [ShopErasureService],
})
export class WebhooksModule {}
