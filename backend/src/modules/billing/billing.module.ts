import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppPlan } from './entities/app-plan.entity';
import { StoreSubscriptionEvent } from './entities/store-subscription-event.entity';
import { StoreSubscription } from './entities/store-subscription.entity';
import { StoreUsage } from './entities/store-usage.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AuthModule } from '../../common/auth/auth.module';
import { ShopifyModule } from '../shopify/shopify.module';

@Module({
  imports: [
    AuthModule,
    ShopifyModule,
    TypeOrmModule.forFeature([
      AppPlan,
      StoreSubscription,
      StoreSubscriptionEvent,
      StoreUsage,
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService, SubscriptionsService],
  exports: [TypeOrmModule, BillingService, SubscriptionsService],
})
export class BillingModule {}
