import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../common/auth/auth.module';
import { Campaign } from './entities/campaign.entity';
import { CampaignTarget } from './entities/campaign-target.entity';
import { PriceChange } from './entities/price-change.entity';
import { ProductTagChange } from './entities/product-tag-change.entity';
import { OverlapService } from './overlap.service';
import { CampaignTargetsService } from './campaign-targets.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

/**
 * The campaign aggregate: the container plus everything it owns — its
 * targets, and the record of what it changed. Activation and revert (Phases
 * 6-7) live here too, because reverting reads the change rows this module
 * owns.
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Campaign,
      CampaignTarget,
      PriceChange,
      ProductTagChange,
    ]),
  ],
  controllers: [CampaignsController],
  providers: [OverlapService, CampaignsService, CampaignTargetsService],
  exports: [
    TypeOrmModule,
    OverlapService,
    CampaignsService,
    CampaignTargetsService,
  ],
})
export class CampaignsModule {}
