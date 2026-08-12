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

  @Get('status')
  getStatus(@CurrentShop() shop: Shop) {
    return {
      initializationStatus: shop.initializationStatus,
      defaultSettings: shop.defaultSettings,
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
