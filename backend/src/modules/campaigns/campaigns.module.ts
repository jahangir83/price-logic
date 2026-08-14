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
import { CampaignPreviewService } from './preview.service';
import { TargetResolverService } from './target-resolver.service';
import { ShopifyModule } from '../shopify/shopify.module';
import { BillingModule } from '../billing/billing.module';
import { JobsModule } from '../jobs/jobs.module';
import { CsvRow } from '../imports/entities/csv-row.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ActivationService } from './activation.service';
import { CampaignJobHandlers } from './campaign-job.handlers';

/**
 * The campaign aggregate: the container plus everything it owns — its
 * targets, and the record of what it changed. Activation and revert (Phases
 * 6-7) live here too, because reverting reads the change rows this module
 * owns.
 */
@Module({
  imports: [
    AuthModule,
    ShopifyModule,
    BillingModule,
    JobsModule,
    TypeOrmModule.forFeature([
      Campaign,
      CampaignTarget,
      PriceChange,
      ProductTagChange,
      CsvRow,
      Shop,
    ]),
  ],
  controllers: [CampaignsController],
  providers: [
    OverlapService,
    CampaignsService,
    CampaignTargetsService,
    TargetResolverService,
    CampaignPreviewService,
    ActivationService,
    CampaignJobHandlers,
  ],
  exports: [
    TypeOrmModule,
    OverlapService,
    CampaignsService,
    CampaignTargetsService,
    TargetResolverService,
    CampaignPreviewService,
    ActivationService,
  ],
})
export class CampaignsModule {}
