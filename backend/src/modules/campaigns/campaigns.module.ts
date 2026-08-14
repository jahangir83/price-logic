import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from './entities/campaign.entity';
import { CampaignTarget } from './entities/campaign-target.entity';
import { PriceChange } from './entities/price-change.entity';
import { ProductTagChange } from './entities/product-tag-change.entity';

/**
 * The campaign aggregate: the container plus everything it owns — its
 * targets, and the record of what it changed. Activation and revert (Phases
 * 6-7) live here too, because reverting reads the change rows this module
 * owns.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      CampaignTarget,
      PriceChange,
      ProductTagChange,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class CampaignsModule {}
