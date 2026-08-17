import {
  DEFAULT_STORE_SETTINGS,
  EMPTY_ONBOARDING,
  PricingStrategy,
  SetupStep,
} from '@pricelogic/shared';
import type { Repository } from 'typeorm';
import type { Campaign } from '../../campaigns/entities/campaign.entity';
import type { Shop } from '../../shops/entities/shop.entity';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let shop: Shop;
  let shopRepository: {
    findOneByOrFail: jest.Mock;
    save: jest.Mock;
  };
  let campaignRepository: { count: jest.Mock };
  let service: SettingsService;

  function build(overrides: Partial<Shop> = {}, campaignCount = 0): void {
    shop = {
      id: 'shop-1',
      defaultSettings: { ...DEFAULT_STORE_SETTINGS },
      onboarding: { ...EMPTY_ONBOARDING },
      ...overrides,
    } as Shop;

    shopRepository = {
      findOneByOrFail: jest.fn().mockResolvedValue(shop),
      save: jest.fn((entity: Shop) => Promise.resolve(entity)),
    };
    campaignRepository = { count: jest.fn().mockResolvedValue(campaignCount) };

    service = new SettingsService(
      shopRepository as unknown as Repository<Shop>,
      campaignRepository as unknown as Repository<Campaign>,
    );
  }

  beforeEach(() => build());

  describe('getSettings', () => {
    it('fills missing keys from the defaults', async () => {
      // The shape every shop installed before defaults were seeded is in.
      build({ defaultSettings: {} });

      const settings = await service.getSettings('shop-1');

      expect(settings).toEqual(DEFAULT_STORE_SETTINGS);
    });

    it('persists what it filled in, so the gap closes once', async () => {
      build({ defaultSettings: {} });

      await service.getSettings('shop-1');

      expect(shopRepository.save).toHaveBeenCalledTimes(1);
      expect(shop.defaultSettings).toEqual(DEFAULT_STORE_SETTINGS);
    });

    it('does not write when the settings are already complete', async () => {
      // A read is the most frequent call here; writing on every one would put a
      // pointless UPDATE in front of every page load.
      await service.getSettings('shop-1');

      expect(shopRepository.save).not.toHaveBeenCalled();
    });

    it('keeps the merchant’s value over the default', async () => {
      build({ defaultSettings: { minimumPrice: '9.99' } });

      const settings = await service.getSettings('shop-1');

      expect(settings.minimumPrice).toBe('9.99');
      expect(settings.minimumMarginPercent).toBe(
        DEFAULT_STORE_SETTINGS.minimumMarginPercent,
      );
    });
  });

  describe('updateSettings', () => {
    it('applies only the fields that were sent', async () => {
      build({
        defaultSettings: { ...DEFAULT_STORE_SETTINGS, minimumPrice: '3.00' },
      });

      const settings = await service.updateSettings('shop-1', {
        minimumMarginPercent: 15,
      });

      expect(settings.minimumMarginPercent).toBe(15);
      expect(settings.minimumPrice).toBe('3.00');
    });

    it('treats an explicit null maximumPrice as removing the ceiling', async () => {
      // Distinct from "not editing this field" — collapsing the two would make
      // a ceiling impossible to remove once set.
      build({
        defaultSettings: { ...DEFAULT_STORE_SETTINGS, maximumPrice: '50.00' },
      });

      const settings = await service.updateSettings('shop-1', {
        maximumPrice: null,
      });

      expect(settings.maximumPrice).toBeNull();
    });

    it('leaves a field alone when it is undefined', async () => {
      build({
        defaultSettings: { ...DEFAULT_STORE_SETTINGS, maximumPrice: '50.00' },
      });

      const settings = await service.updateSettings('shop-1', {
        maximumPrice: undefined,
        minimumPrice: '1.00',
      });

      expect(settings.maximumPrice).toBe('50.00');
    });

    it('stores a strategy the merchant picked', async () => {
      const settings = await service.updateSettings('shop-1', {
        defaultPricingStrategy: PricingStrategy.TARGET_MARGIN,
      });

      expect(settings.defaultPricingStrategy).toBe(
        PricingStrategy.TARGET_MARGIN,
      );
    });
  });

  describe('getGuide', () => {
    it('reports every step open for a brand new shop', async () => {
      const guide = await service.getGuide('shop-1');

      expect(guide.completedCount).toBe(0);
      expect(guide.totalCount).toBe(3);
      expect(guide.dismissed).toBe(false);
    });

    it('derives the campaign step from the campaigns table', async () => {
      build({}, 2);

      const guide = await service.getGuide('shop-1');
      const step = guide.steps.find(
        (candidate) => candidate.step === SetupStep.FIRST_CAMPAIGN,
      );

      expect(step?.completed).toBe(true);
      // Null because the campaign carries its own creation date; copying it
      // here would be a second, staler copy of the same fact.
      expect(step?.completedAt).toBeNull();
    });

    it('reads a visited step from the recorded timestamp', async () => {
      build({
        onboarding: {
          ...EMPTY_ONBOARDING,
          settingsVisitedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      const guide = await service.getGuide('shop-1');
      const step = guide.steps.find(
        (candidate) => candidate.step === SetupStep.SETTINGS,
      );

      expect(step?.completed).toBe(true);
      expect(step?.completedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('still reports the steps once dismissed', async () => {
      // Dismissing hides the card. It is not a reason to stop knowing what the
      // merchant has done.
      build({
        onboarding: {
          ...EMPTY_ONBOARDING,
          dismissedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      const guide = await service.getGuide('shop-1');

      expect(guide.dismissed).toBe(true);
      expect(guide.steps).toHaveLength(3);
    });

    it('survives a shop whose onboarding column is still an empty object', async () => {
      // Every shop that existed before the migration is in this state.
      build({ onboarding: {} as Shop['onboarding'] });

      const guide = await service.getGuide('shop-1');

      expect(guide.completedCount).toBe(0);
      expect(guide.dismissed).toBe(false);
    });
  });

  describe('markVisited', () => {
    it('records the first visit', async () => {
      await service.markVisited('shop-1', SetupStep.SETTINGS);

      expect(shop.onboarding.settingsVisitedAt).not.toBeNull();
      expect(shopRepository.save).toHaveBeenCalledTimes(1);
    });

    it('keeps the first timestamp on a second visit', async () => {
      // This is called on every render of the settings page. Overwriting would
      // turn "when they first saw it" into "a moment ago", permanently.
      build({
        onboarding: {
          ...EMPTY_ONBOARDING,
          settingsVisitedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      await service.markVisited('shop-1', SetupStep.SETTINGS);

      expect(shop.onboarding.settingsVisitedAt).toBe(
        '2026-01-01T00:00:00.000Z',
      );
      expect(shopRepository.save).not.toHaveBeenCalled();
    });

    it('keeps the two visitable steps apart', async () => {
      await service.markVisited('shop-1', SetupStep.FAQ);

      expect(shop.onboarding.faqVisitedAt).not.toBeNull();
      expect(shop.onboarding.settingsVisitedAt).toBeNull();
    });
  });

  describe('dismiss', () => {
    it('records the dismissal', async () => {
      await service.dismiss('shop-1');

      expect(shop.onboarding.dismissedAt).not.toBeNull();
    });

    it('does not move the timestamp on a second dismissal', async () => {
      build({
        onboarding: {
          ...EMPTY_ONBOARDING,
          dismissedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      await service.dismiss('shop-1');

      expect(shop.onboarding.dismissedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(shopRepository.save).not.toHaveBeenCalled();
    });
  });
});
