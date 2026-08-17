import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../common/auth/auth.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ShopsModule } from '../shops/shops.module';
import {
  SettingsController,
  SetupGuideController,
} from './controllers/settings.controller';
import { SettingsService } from './services/settings.service';

/**
 * The shop's settings and the setup guide.
 *
 * `Campaign` is here for a count and nothing else — the guide's third step is
 * derived from whether the shop has one, and a repository is the cheapest
 * honest way to ask.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Shop, Campaign]),
    AuthModule,
    ShopsModule,
  ],
  controllers: [SettingsController, SetupGuideController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
