import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../common/auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { JobsModule } from '../jobs/jobs.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { Shop } from '../shops/entities/shop.entity';
import { CsvImport } from './entities/csv-import.entity';
import { CsvRow } from './entities/csv-row.entity';
import { ImportsController } from './controllers/imports.controller';
import { ImportsService } from './services/imports.service';
import { SheetJobHandlers } from './sheet-job.handlers';

@Module({
  imports: [
    AuthModule,
    JobsModule,
    ShopifyModule,
    CampaignsModule,
    TypeOrmModule.forFeature([CsvImport, CsvRow, Campaign, Shop]),
  ],
  controllers: [ImportsController],
  providers: [ImportsService, SheetJobHandlers],
  exports: [TypeOrmModule, ImportsService],
})
export class ImportsModule {}
