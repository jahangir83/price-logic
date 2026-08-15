import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentShop } from '../../common/tenant/current-shop.decorator';
import { ShopGuard } from '../../common/auth/shop.guard';
import { Shop } from '../shops/entities/shop.entity';
import { UpdateDefaultSettingsDto } from './dto/update-default-settings.dto';
import { StoreInitService } from './store-init.service';

@Controller('store-init')
@UseGuards(ShopGuard)
export class StoreInitController {
  constructor(private readonly storeInitService: StoreInitService) {}

  /**
   * What the app needs to know about this shop before it can render anything.
   *
   * `currency` is here because every screen that shows money needs it and the
   * client must not guess: a price formatted as USD when the shop trades in JPY
   * is wrong by a factor of a hundred, and the shop's own currency is the only
   * authority on that. It comes from the shop record rather than the request so
   * a client cannot ask to be told a different one.
   */
  @Get('status')
  getStatus(@CurrentShop() shop: Shop) {
    return {
      initializationStatus: shop.initializationStatus,
      defaultSettings: shop.defaultSettings,
      currency: shop.currency,
    };
  }

  @Patch('settings')
  async updateSettings(
    @CurrentShop() shop: Shop,
    @Body() dto: UpdateDefaultSettingsDto,
  ) {
    const updated = await this.storeInitService.updateDefaultSettings(
      shop.id,
      dto,
    );
    return { defaultSettings: updated.defaultSettings };
  }

  @Post('complete')
  async complete(@CurrentShop() shop: Shop) {
    const updated = await this.storeInitService.completeSetup(shop.id);
    return { initializationStatus: updated.initializationStatus };
  }
}
