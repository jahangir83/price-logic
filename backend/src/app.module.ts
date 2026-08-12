import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AppController } from './app.controller';
import { AuthModule } from './common/auth/auth.module';
import { ShopifyAuthModule } from './modules/shopify-auth/shopify-auth.module';
import { ShopsModule } from './modules/shops/shops.module';
import { StoreInitModule } from './modules/store-init/store-init.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ProductsModule } from './modules/products/products.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ImportsModule } from './modules/imports/imports.module';
import { PricingRulesModule } from './modules/pricing-rules/pricing-rules.module';
import { PricingOperationsModule } from './modules/pricing-operations/pricing-operations.module';
import { PriceHistoryModule } from './modules/price-history/price-history.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('databaseUrl'),
        autoLoadEntities: true,
        // Schema is owned by migrations from Phase 2 onward (see
        // src/database/). Never enable synchronize, even in development —
        // it would drift silently from the committed migration history.
        synchronize: false,
      }),
    }),
    AuthModule,
    ShopsModule,
    ShopifyAuthModule,
    StoreInitModule,
    WebhooksModule,
    ProductsModule,
    SuppliersModule,
    ImportsModule,
    PricingRulesModule,
    PricingOperationsModule,
    PriceHistoryModule,
    CampaignsModule,
    SchedulesModule,
    AuditLogsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
