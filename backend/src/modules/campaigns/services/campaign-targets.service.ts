import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CampaignTargetMode,
  CampaignTargetType,
  GID_TARGET_TYPES,
} from '@pricelogic/shared';
import { Repository } from 'typeorm';
import { CampaignTarget } from '../entities/campaign-target.entity';

export interface TargetInput {
  mode: CampaignTargetMode;
  targetType: CampaignTargetType;
  targetValue: string;
}

/**
 * The include and exclude rows of a campaign.
 *
 * All six target types, including `VARIANT` on both sides — the constitution
 * requires it, and "this whole collection except the extra-large" cannot be
 * expressed at product granularity.
 */
@Injectable()
export class CampaignTargetsService {
  private readonly logger = new Logger(CampaignTargetsService.name);

  constructor(
    @InjectRepository(CampaignTarget)
    private readonly targets: Repository<CampaignTarget>,
  ) {}

  async list(shopId: string, campaignId: string): Promise<CampaignTarget[]> {
    return this.targets.find({
      where: { shopId, campaignId },
      order: { mode: 'ASC', targetType: 'ASC', targetValue: 'ASC' },
    });
  }

  /**
   * Add a target, or do nothing if it is already there.
   *
   * `orIgnore` rather than a read-then-insert: the unique constraint is the
   * arbiter, and checking first would still race two rapid clicks into a 500.
   * Adding a target you already have is not an error the merchant should see.
   */
  async add(
    shopId: string,
    campaignId: string,
    input: TargetInput,
  ): Promise<CampaignTarget> {
    const normalised = normalise(input);

    await this.targets
      .createQueryBuilder()
      .insert()
      .into(CampaignTarget)
      .values({ shopId, campaignId, ...normalised })
      .orIgnore()
      .execute();

    return this.targets.findOneOrFail({
      where: { shopId, campaignId, ...normalised },
    });
  }

  async addMany(
    shopId: string,
    campaignId: string,
    inputs: TargetInput[],
  ): Promise<number> {
    if (inputs.length === 0) return 0;

    const values = dedupe(inputs.map(normalise)).map((target) => ({
      shopId,
      campaignId,
      ...target,
    }));

    const result = await this.targets
      .createQueryBuilder()
      .insert()
      .into(CampaignTarget)
      .values(values)
      .orIgnore()
      .execute();

    return result.identifiers.filter(Boolean).length;
  }

  /** Removing a target that is not there is a no-op, not a 404. */
  async remove(
    shopId: string,
    campaignId: string,
    input: TargetInput,
  ): Promise<void> {
    await this.targets.delete({ shopId, campaignId, ...normalise(input) });
  }

  async removeById(
    shopId: string,
    campaignId: string,
    targetId: string,
  ): Promise<void> {
    await this.targets.delete({ shopId, campaignId, id: targetId });
  }

  async clear(
    shopId: string,
    campaignId: string,
    mode?: CampaignTargetMode,
  ): Promise<void> {
    await this.targets.delete({
      shopId,
      campaignId,
      ...(mode ? { mode } : {}),
    });
  }

  /** Counts per mode, for the form's running total. */
  async countByMode(
    shopId: string,
    campaignId: string,
  ): Promise<Record<CampaignTargetMode, number>> {
    const rows = await this.targets
      .createQueryBuilder('t')
      .select('t.mode', 'mode')
      .addSelect('count(*)', 'count')
      .where('t.shop_id = :shopId AND t.campaign_id = :campaignId', {
        shopId,
        campaignId,
      })
      .groupBy('t.mode')
      .getRawMany<{ mode: CampaignTargetMode; count: string }>();

    const counts = {
      [CampaignTargetMode.INCLUDE]: 0,
      [CampaignTargetMode.EXCLUDE]: 0,
    };
    for (const row of rows) {
      counts[row.mode] = Number(row.count);
    }
    return counts;
  }
}

/**
 * Trim everything, and lower-case the free-form types.
 *
 * TAG, VENDOR and PRODUCT_TYPE are compared case-insensitively when resolving
 * targets — Shopify treats them that way — so storing "Sale" and "sale" as two
 * rows would let the unique constraint pass while the resolver saw one target
 * twice. GIDs keep their case: they are opaque identifiers.
 */
function normalise(input: TargetInput): TargetInput {
  const value = input.targetValue.trim();
  return {
    mode: input.mode,
    targetType: input.targetType,
    targetValue: GID_TARGET_TYPES.includes(input.targetType)
      ? value
      : value.toLowerCase(),
  };
}

function dedupe(targets: TargetInput[]): TargetInput[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.mode}:${target.targetType}:${target.targetValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
