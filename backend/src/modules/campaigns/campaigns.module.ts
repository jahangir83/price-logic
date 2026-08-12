import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from './entities/campaign.entity';
import { CampaignTagRule } from './entities/campaign-tag-rule.entity';
import { CampaignTagApplication } from './entities/campaign-tag-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      CampaignTagRule,
      CampaignTagApplication,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class CampaignsModule {}
