import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppPlan } from './entities/app-plan.entity';
import { StoreSubscriptionEvent } from './entities/store-subscription-event.entity';
import { StoreSubscription } from './entities/store-subscription.entity';
import { StoreUsage } from './entities/store-usage.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppPlan,
      StoreSubscription,
      StoreSubscriptionEvent,
      StoreUsage,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class BillingModule {}
