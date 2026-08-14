import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CampaignStatus,
  DEFAULT_PAGE_SIZE,
  PriceChangeStatus,
  type CampaignProgressResponse,
  type CreateCampaignRequest,
  type ListCampaignsQuery,
  type UpdateCampaignRequest,
  type CampaignResultsResponse,
  type PaginatedResponse,
  type PriceChangeDto,
} from '@pricelogic/shared';
import { ILike, Repository } from 'typeorm';
import { TenantScopedRepository } from '../../common/tenant/tenant-scoped.repository';
import {
  CampaignTransitionError,
  assertTransition,
  isEditableCampaignStatus,
} from './campaign-status';
import { validateCampaign } from './campaign-rules';
import { CampaignTarget } from './entities/campaign-target.entity';
import { Campaign } from './entities/campaign.entity';
import { PriceChange } from './entities/price-change.entity';
/**
 * The service takes the **shared** request contract, not the DTO class.
 *
 * Two reasons. The sheet-approval path builds a campaign server-side and has
 * no DTO to construct, and the DTO carries internal marker fields the
 * validator reads — leaking those into every caller's type would make an
 * ordinary `{ title: 'x' }` fail to compile.
 */
export type CreateCampaignInput = CreateCampaignRequest;
export type UpdateCampaignInput = UpdateCampaignRequest;
export type ListCampaignsInput = ListCampaignsQuery;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaigns: Repository<Campaign>,
    @InjectRepository(CampaignTarget)
    private readonly targets: Repository<CampaignTarget>,
    @InjectRepository(PriceChange)
    private readonly priceChanges: Repository<PriceChange>,
  ) {}

  /**
   * What a campaign did, one page at a time.
   *
   * Ordered failures first. A merchant opening this screen is almost always
   * asking "what went wrong?", and making them page past four thousand
   * successful rows to find out is a worse answer than no screen at all.
   */
  async results(
    shopId: string,
    id: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<CampaignResultsResponse> {
    await this.findOne(shopId, id);

    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(
      Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      250,
    );

    const [items, totalItems] = await this.priceChanges
      .createQueryBuilder('pc')
      .where('pc.shop_id = :shopId AND pc.campaign_id = :id', { shopId, id })
      .orderBy(
        `CASE pc.status
           WHEN 'FAILED' THEN 0
           WHEN 'PENDING' THEN 1
           WHEN 'APPLIED' THEN 2
           WHEN 'REVERTED' THEN 3
           ELSE 4 END`,
        'ASC',
      )
      .addOrderBy('pc.product_title', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const counts = await this.countByStatus(shopId, id);

    return {
      campaignId: id,
      applied: counts[PriceChangeStatus.APPLIED] ?? 0,
      failed: counts[PriceChangeStatus.FAILED] ?? 0,
      skipped: counts[PriceChangeStatus.SKIPPED] ?? 0,
      reverted: counts[PriceChangeStatus.REVERTED] ?? 0,
      changes: items as unknown as PriceChangeDto[],
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  /** Live counters, for the progress bar. */
  async progress(
    shopId: string,
    id: string,
  ): Promise<CampaignProgressResponse> {
    const campaign = await this.findOne(shopId, id);
    const counts = await this.countByStatus(shopId, id);

    const pending = counts[PriceChangeStatus.PENDING] ?? 0;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    return {
      campaignId: id,
      status: campaign.status,
      // Still work outstanding, so the UI keeps polling.
      running: pending > 0,
      total,
      applied: counts[PriceChangeStatus.APPLIED] ?? 0,
      failed: counts[PriceChangeStatus.FAILED] ?? 0,
      skipped: counts[PriceChangeStatus.SKIPPED] ?? 0,
      reverted: counts[PriceChangeStatus.REVERTED] ?? 0,
      pending,
    };
  }

  /** One indexed group-by rather than five counts. */
  private async countByStatus(
    shopId: string,
    campaignId: string,
  ): Promise<Partial<Record<PriceChangeStatus, number>>> {
    const rows = await this.priceChanges
      .createQueryBuilder('pc')
      .select('pc.status', 'status')
      .addSelect('count(*)', 'count')
      .where('pc.shop_id = :shopId AND pc.campaign_id = :campaignId', {
        shopId,
        campaignId,
      })
      .groupBy('pc.status')
      .getRawMany<{ status: PriceChangeStatus; count: string }>();

    return Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    );
  }

  /**
   * Every read and write goes through here, so a query can never be written
   * without its shop filter. The composite foreign keys make a cross-tenant
   * row unrepresentable anyway; this stops one being *read*.
   */
  private scoped(shopId: string) {
    return new TenantScopedRepository(this.campaigns, shopId);
  }

  async create(shopId: string, dto: CreateCampaignInput): Promise<Campaign> {
    // The DTO validator already ran these; running them again means the
    // sheet-approval path, which builds a campaign without a DTO, cannot skip
    // them by accident.
    const problem = validateCampaign(dto, { isCreate: true });
    if (problem) throw new BadRequestException(problem);

    const campaign = this.campaigns.create({
      ...stripControlFields(dto),
      shopId,
      status: CampaignStatus.DRAFT,
      targets: undefined,
    } as Partial<Campaign>);

    const saved = await this.campaigns.save(campaign);

    if (dto.targets?.length) {
      await this.replaceTargets(shopId, saved.id, dto.targets);
    }

    this.logger.log(`Created campaign ${saved.id} for shop ${shopId}`);
    return saved;
  }

  async findOne(shopId: string, id: string): Promise<Campaign> {
    const campaign = await this.scoped(shopId).findOne({ id });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  async list(
    shopId: string,
    query: ListCampaignsInput,
  ): Promise<PaginatedResponse<Campaign>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Record<string, unknown> = { shopId };
    if (query.status) where.status = query.status;
    if (query.search) where.title = ILike(`%${query.search}%`);

    const [items, totalItems] = await this.campaigns.findAndCount({
      where,
      // Scheduled first and soonest first: the list answers "what is about to
      // happen", which a created-at ordering does not.
      order: { startAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  async update(
    shopId: string,
    id: string,
    dto: UpdateCampaignInput,
  ): Promise<Campaign> {
    const campaign = await this.findOne(shopId, id);
    this.assertEditable(campaign);

    // Validated against the merged result, not the patch: changing only
    // `adjustmentUnit` must still be checked against the value already stored,
    // or a half-specified adjustment slips through one field at a time.
    const merged = { ...campaign, ...stripControlFields(dto) };
    const problem = validateCampaign(merged, { isCreate: false });
    if (problem) throw new BadRequestException(problem);

    Object.assign(campaign, stripControlFields(dto));
    return this.campaigns.save(campaign);
  }

  /**
   * Soft delete, because `price_changes` references the campaign and revert
   * has to stay able to read what it did long after the merchant tidied the
   * campaign out of their list.
   */
  async remove(shopId: string, id: string): Promise<void> {
    const campaign = await this.findOne(shopId, id);
    if (campaign.status === CampaignStatus.ACTIVE) {
      throw new ConflictException(
        'Deactivate this campaign before deleting it, so its prices are put back.',
      );
    }
    await this.campaigns.softDelete({ id: campaign.id, shopId });
  }

  /**
   * The only place `status` is assigned. Phases 6 and 7 call this rather than
   * writing the column, so an illegal transition is impossible to express.
   */
  async changeStatus(
    shopId: string,
    id: string,
    to: CampaignStatus,
  ): Promise<Campaign> {
    const campaign = await this.findOne(shopId, id);
    try {
      assertTransition(campaign.status, to);
    } catch (error) {
      if (error instanceof CampaignTransitionError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }

    if (to === CampaignStatus.SCHEDULED && !campaign.startAt) {
      throw new BadRequestException('A scheduled campaign needs a start date.');
    }

    campaign.status = to;
    return this.campaigns.save(campaign);
  }

  private assertEditable(campaign: Campaign): void {
    if (!isEditableCampaignStatus(campaign.status)) {
      throw new ConflictException(
        `A ${campaign.status.toLowerCase()} campaign cannot be edited.`,
      );
    }
  }

  /** Replace the whole target set — used by create and by the form's save. */
  async replaceTargets(
    shopId: string,
    campaignId: string,
    targets: {
      mode: CampaignTarget['mode'];
      targetType: CampaignTarget['targetType'];
      targetValue: string;
    }[],
  ): Promise<void> {
    await this.targets.delete({ shopId, campaignId });
    if (targets.length === 0) return;

    await this.targets.insert(
      dedupeTargets(targets).map((target) => ({
        shopId,
        campaignId,
        ...target,
      })),
    );
  }
}

/**
 * The DTO carries two `__`-prefixed markers so the shared validator knows
 * whether it is looking at a create. They must never reach the entity.
 */
function stripControlFields<T extends object>(dto: T): Partial<T> {
  const copy = { ...dto } as Record<string, unknown>;
  delete copy.__isCreate;
  delete copy.__consistency;
  delete copy.targets;
  return copy as Partial<T>;
}

/**
 * The database has a unique constraint on the target tuple; a form that
 * submits the same tag twice is a duplicate, not an error worth showing.
 */
function dedupeTargets<
  T extends { mode: string; targetType: string; targetValue: string },
>(targets: T[]): T[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.mode}:${target.targetType}:${target.targetValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
