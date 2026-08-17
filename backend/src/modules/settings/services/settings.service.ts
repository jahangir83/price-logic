import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DEFAULT_STORE_SETTINGS,
  EMPTY_ONBOARDING,
  SetupStep,
  type SetupGuideDto,
  type SetupStepDto,
  type ShopOnboarding,
  type StoreSettings,
  type UpdateStoreSettingsRequest,
  type VisitableStep,
} from '@pricelogic/shared';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { Shop } from '../../shops/entities/shop.entity';

/**
 * The shop's own settings, and the setup guide that suggests using them.
 *
 * Setup is optional here in the literal sense: nothing in this service can
 * leave a shop unusable, and nothing it records gates any other screen. The
 * guide is a suggestion the merchant can complete, ignore or dismiss.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  /**
   * The shop's settings, complete.
   *
   * Missing keys are filled from the defaults **and written back**, which is
   * what lets every caller treat the result as whole. Shops installed before
   * defaults were seeded are the reason this exists; without it the settings
   * screen would open empty for exactly the merchants who never chose anything.
   */
  async getSettings(shopId: string): Promise<StoreSettings> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    const complete = { ...DEFAULT_STORE_SETTINGS, ...shop.defaultSettings };

    if (!isComplete(shop.defaultSettings)) {
      shop.defaultSettings = complete;
      await this.shopRepository.save(shop);
    }

    return complete;
  }

  /**
   * Applies a partial edit.
   *
   * `undefined` means "not editing this field" and is dropped; `null` on
   * `maximumPrice` means "no ceiling" and is kept. Collapsing the two would
   * make removing a ceiling impossible to express.
   */
  async updateSettings(
    shopId: string,
    patch: UpdateStoreSettingsRequest,
  ): Promise<StoreSettings> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    const current = { ...DEFAULT_STORE_SETTINGS, ...shop.defaultSettings };

    const next: StoreSettings = {
      ...current,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    };

    shop.defaultSettings = next;
    await this.shopRepository.save(shop);
    return next;
  }

  /**
   * The guide, computed rather than read.
   *
   * Two steps come from recorded visits; the third is a count against the
   * campaigns table. Deriving it is the point — a stored "has a campaign" flag
   * can disagree with the campaigns a merchant can see, and then neither the
   * merchant nor we can tell which is right.
   */
  async getGuide(shopId: string): Promise<SetupGuideDto> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    const onboarding = withDefaults(shop.onboarding);

    // Soft-deleted campaigns are excluded by TypeORM's `@DeleteDateColumn`
    // without asking, which is the behaviour wanted: a merchant who created a
    // campaign and deleted it has not got one.
    const campaignCount = await this.campaignRepository.count({
      where: { shopId },
    });

    const steps: SetupStepDto[] = [
      completedAt(SetupStep.SETTINGS, onboarding.settingsVisitedAt),
      completedAt(SetupStep.FAQ, onboarding.faqVisitedAt),
      {
        step: SetupStep.FIRST_CAMPAIGN,
        completed: campaignCount > 0,
        // Null because this step is derived: the campaign carries the date it
        // was created, and copying it here would be a second, staler copy.
        completedAt: null,
      },
    ];

    return {
      steps,
      completedCount: steps.filter((step) => step.completed).length,
      totalCount: steps.length,
      dismissed: onboarding.dismissedAt !== null,
    };
  }

  /**
   * Records that the merchant reached one of the guide's destinations.
   *
   * Idempotent, and deliberately keeps the **first** visit: this is a record of
   * when they first saw the screen, not of the last time they opened it. Every
   * render of the settings page calls this, so overwriting would turn the
   * timestamp into "a moment ago" forever.
   */
  async markVisited(shopId: string, step: VisitableStep): Promise<void> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    const onboarding = withDefaults(shop.onboarding);
    const key = VISIT_KEYS[step];

    if (onboarding[key] !== null) return;

    shop.onboarding = { ...onboarding, [key]: new Date().toISOString() };
    await this.shopRepository.save(shop);
  }

  /** Hides the guide. Never undone by the app — only the merchant decides. */
  async dismiss(shopId: string): Promise<void> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    const onboarding = withDefaults(shop.onboarding);
    if (onboarding.dismissedAt !== null) return;

    shop.onboarding = { ...onboarding, dismissedAt: new Date().toISOString() };
    await this.shopRepository.save(shop);
  }
}

const VISIT_KEYS: Record<VisitableStep, keyof ShopOnboarding> = {
  [SetupStep.SETTINGS]: 'settingsVisitedAt',
  [SetupStep.FAQ]: 'faqVisitedAt',
};

function completedAt(step: SetupStep, at: string | null): SetupStepDto {
  return { step, completed: at !== null, completedAt: at };
}

/** A jsonb column that has only ever held `{}` still has to read as a shape. */
function withDefaults(onboarding: ShopOnboarding | null): ShopOnboarding {
  return { ...EMPTY_ONBOARDING, ...(onboarding ?? {}) };
}

function isComplete(settings: Partial<StoreSettings>): boolean {
  return Object.keys(DEFAULT_STORE_SETTINGS).every((key) => key in settings);
}
