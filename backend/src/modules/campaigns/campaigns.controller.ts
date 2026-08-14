import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CampaignTargetMode, type PaginatedResponse } from '@pricelogic/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { ShopGuard } from '../../common/auth/shop.guard';
import { Shop } from '../shops/entities/shop.entity';
import { CampaignTargetsService } from './campaign-targets.service';
import { CampaignsService } from './campaigns.service';
import { allowedTransitions } from './campaign-status';
import {
  CampaignTargetInputDto,
  ChangeCampaignStatusDto,
  CreateCampaignDto,
  ListCampaignsDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';
import { Campaign } from './entities/campaign.entity';
import { CampaignTarget } from './entities/campaign-target.entity';

interface RequestWithShop {
  shop: Shop;
}

/**
 * Campaign CRUD.
 *
 * The shop comes from `ShopGuard`, never from the body or a query parameter —
 * a merchant editing a URL must not be able to reach another shop's campaign,
 * and the service takes `shopId` as its first argument precisely so a handler
 * cannot forget to pass it.
 */
@Controller('campaigns')
@UseGuards(SessionAuthGuard, ShopGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly targets: CampaignTargetsService,
  ) {}

  @Get()
  async list(
    @Req() request: RequestWithShop,
    @Query() query: ListCampaignsDto,
  ): Promise<PaginatedResponse<Campaign>> {
    return this.campaigns.list(request.shop.id, query);
  }

  @Post()
  async create(
    @Req() request: RequestWithShop,
    @Body() dto: CreateCampaignDto,
  ): Promise<Campaign> {
    return this.campaigns.create(request.shop.id, dto);
  }

  @Get(':id')
  async findOne(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Campaign & { allowedTransitions: string[] }> {
    const campaign = await this.campaigns.findOne(request.shop.id, id);
    // The UI renders its action buttons from this rather than reimplementing
    // the transition table and drifting from it.
    return {
      ...campaign,
      allowedTransitions: [...allowedTransitions(campaign.status)],
    };
  }

  @Patch(':id')
  async update(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<Campaign> {
    return this.campaigns.update(request.shop.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.campaigns.remove(request.shop.id, id);
  }

  @Patch(':id/status')
  async changeStatus(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeCampaignStatusDto,
  ): Promise<Campaign> {
    return this.campaigns.changeStatus(request.shop.id, id, dto.status);
  }

  // -----------------------------------------------------------------
  // Targets
  // -----------------------------------------------------------------

  @Get(':id/targets')
  async listTargets(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{
    targets: CampaignTarget[];
    counts: Record<CampaignTargetMode, number>;
  }> {
    const [targets, counts] = await Promise.all([
      this.targets.list(request.shop.id, id),
      this.targets.countByMode(request.shop.id, id),
    ]);
    return { targets, counts };
  }

  @Post(':id/targets')
  async addTarget(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CampaignTargetInputDto,
  ): Promise<CampaignTarget> {
    // Confirms the campaign belongs to this shop before touching its children.
    await this.campaigns.findOne(request.shop.id, id);
    return this.targets.add(request.shop.id, id, dto);
  }

  @Delete(':id/targets/:targetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTarget(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<void> {
    await this.campaigns.findOne(request.shop.id, id);
    await this.targets.removeById(request.shop.id, id, targetId);
  }
}
