import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  isVisitableStep,
  type SetupGuideDto,
  type StoreSettingsResponse,
} from '@pricelogic/shared';
import { ShopGuard } from '../../../common/auth/shop.guard';
import { CurrentShop } from '../../../common/tenant/current-shop.decorator';
import { Shop } from '../../shops/entities/shop.entity';
import { UpdateSettingsDto } from '../dto/update-settings.dto';
import { SettingsService } from '../services/settings.service';

@Controller('settings')
@UseGuards(ShopGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** Always complete — anything missing is filled from the defaults on read. */
  @Get()
  async get(@CurrentShop() shop: Shop): Promise<StoreSettingsResponse> {
    return { settings: await this.settingsService.getSettings(shop.id) };
  }

  @Patch()
  async update(
    @CurrentShop() shop: Shop,
    @Body() dto: UpdateSettingsDto,
  ): Promise<StoreSettingsResponse> {
    return {
      settings: await this.settingsService.updateSettings(shop.id, dto),
    };
  }
}

@Controller('setup-guide')
@UseGuards(ShopGuard)
export class SetupGuideController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  guide(@CurrentShop() shop: Shop): Promise<SetupGuideDto> {
    return this.settingsService.getGuide(shop.id);
  }

  /**
   * Records that the merchant reached a step's destination.
   *
   * A POST rather than something the GET infers, because arriving somewhere is
   * an event and the page that arrives is the only thing that knows it
   * happened. The step name is checked against the two that are visitable —
   * `FIRST_CAMPAIGN` is derived from the campaigns table and must not be
   * settable by asking.
   */
  @Post('steps/:step/seen')
  async markSeen(
    @CurrentShop() shop: Shop,
    @Param('step') step: string,
  ): Promise<SetupGuideDto> {
    if (!isVisitableStep(step)) {
      throw new BadRequestException(`${step} is not a step that is visited`);
    }
    await this.settingsService.markVisited(shop.id, step);
    return this.settingsService.getGuide(shop.id);
  }

  @Post('dismiss')
  async dismiss(@CurrentShop() shop: Shop): Promise<SetupGuideDto> {
    await this.settingsService.dismiss(shop.id);
    return this.settingsService.getGuide(shop.id);
  }
}
