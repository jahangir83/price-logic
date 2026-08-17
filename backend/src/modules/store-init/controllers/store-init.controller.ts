import { Controller, Get, UseGuards } from '@nestjs/common';
import { ShopGuard } from '../../../common/auth/shop.guard';
import { CurrentShop } from '../../../common/tenant/current-shop.decorator';
import { Shop } from '../../shops/entities/shop.entity';

@Controller('store-init')
@UseGuards(ShopGuard)
export class StoreInitController {
  /**
   * What the app needs to know about this shop before it can render anything.
   *
   * `currency` is here because every screen that shows money needs it and the
   * client must not guess: a price formatted as USD when the shop trades in JPY
   * is wrong by a factor of a hundred, and the shop's own currency is the only
   * authority on that. It comes from the shop record rather than the request so
   * a client cannot ask to be told a different one.
   *
   * Settings used to be returned and edited here. They moved to `/settings`
   * when the setup wizard was retired — this endpoint answers "what is this
   * shop", not "what has the merchant chosen".
   */
  @Get('status')
  getStatus(@CurrentShop() shop: Shop) {
    return {
      initializationStatus: shop.initializationStatus,
      currency: shop.currency,
    };
  }
}
