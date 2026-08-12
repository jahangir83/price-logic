import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ShopsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
