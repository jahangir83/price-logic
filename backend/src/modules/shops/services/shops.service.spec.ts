import { Repository } from 'typeorm';
import { DEFAULT_STORE_SETTINGS, EMPTY_ONBOARDING } from '@pricelogic/shared';
import { EncryptionService } from '../../../common/crypto/encryption.service';
import {
  DuplicatePolicy,
  InitializationStatus,
  Shop,
  ShopStatus,
} from '../entities/shop.entity';
import { ShopsService } from './shops.service';

describe('ShopsService', () => {
  let repository: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let encryptionService: { encrypt: jest.Mock; decrypt: jest.Mock };
  let service: ShopsService;

  beforeEach(() => {
    repository = {
      findOneBy: jest.fn(),
      create: jest.fn((input) => input as Shop),
      save: jest.fn((entity) =>
        Promise.resolve({ id: 'generated-id', ...entity } as Shop),
      ),
      update: jest.fn(),
    };
    encryptionService = {
      encrypt: jest.fn((plaintext: string) => `enc(${plaintext})`),
      decrypt: jest.fn((ciphertext: string) =>
        ciphertext.replace(/^enc\(|\)$/g, ''),
      ),
    };

    service = new ShopsService(
      repository as unknown as Repository<Shop>,
      encryptionService as unknown as EncryptionService,
    );
  });

  describe('upsertFromInstall', () => {
    it('creates a new Shop when no existing shopifyShopId matches', async () => {
      repository.findOneBy.mockResolvedValue(null);

      const shop = await service.upsertFromInstall({
        shopifyShopId: '123',
        shopDomain: 'my-store.myshopify.com',
        accessToken: 'shpat_abc',
      });

      expect(encryptionService.encrypt).toHaveBeenCalledWith('shpat_abc');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shopifyShopId: '123',
          shopDomain: 'my-store.myshopify.com',
          accessTokenEncrypted: 'enc(shpat_abc)',
          status: ShopStatus.ACTIVE,
          // Set up on arrival, because setup is optional: a shop the merchant
          // has answered nothing for still has to be usable.
          initializationStatus: InitializationStatus.COMPLETE,
          defaultSettings: DEFAULT_STORE_SETTINGS,
          onboarding: EMPTY_ONBOARDING,
        }),
      );
      expect(shop.status).toBe(ShopStatus.ACTIVE);
    });

    it('updates the existing Shop in place on reinstall (never duplicates)', async () => {
      const existing: Shop = {
        id: 'shop-1',
        shopifyShopId: '123',
        shopDomain: 'my-store.myshopify.com',
        accessTokenEncrypted: 'enc(old-token)',
        currency: 'USD',
        timezone: 'UTC',
        status: ShopStatus.DISCONNECTED,
        initializationStatus: InitializationStatus.COMPLETE,
        defaultSettings: { minimumPrice: '5.00' },
        onboarding: {
          ...EMPTY_ONBOARDING,
          faqVisitedAt: '2026-01-01T00:00:00.000Z',
        },
        duplicatePolicy: DuplicatePolicy.HIGHEST_DISCOUNT,
        overrideActiveVariantLimit: null,
        overrideActiveCampaignLimit: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repository.findOneBy.mockResolvedValue(existing);

      const shop = await service.upsertFromInstall({
        shopifyShopId: '123',
        shopDomain: 'my-store.myshopify.com',
        accessToken: 'shpat_new',
      });

      expect(repository.create).not.toHaveBeenCalled();
      expect(shop.id).toBe('shop-1');
      expect(shop.accessTokenEncrypted).toBe('enc(shpat_new)');
      expect(shop.status).toBe(ShopStatus.ACTIVE);
    });

    it('leaves a reinstalling shop its settings and onboarding', async () => {
      // They survived the uninstall, and the merchant has not asked to be reset
      // to defaults. Resetting here would be the app discarding a decision it
      // was specifically built to remember.
      const existing = {
        id: 'shop-1',
        shopifyShopId: '123',
        status: ShopStatus.DISCONNECTED,
        defaultSettings: { minimumPrice: '5.00' },
        onboarding: {
          ...EMPTY_ONBOARDING,
          faqVisitedAt: '2026-01-01T00:00:00.000Z',
        },
      } as Shop;
      repository.findOneBy.mockResolvedValue(existing);

      const shop = await service.upsertFromInstall({
        shopifyShopId: '123',
        shopDomain: 'my-store.myshopify.com',
        accessToken: 'shpat_new',
      });

      expect(shop.defaultSettings).toEqual({ minimumPrice: '5.00' });
      expect(shop.onboarding.faqVisitedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('getDecryptedAccessToken', () => {
    it('delegates to the encryption service', () => {
      const shop = { accessTokenEncrypted: 'enc(shpat_abc)' } as Shop;
      expect(service.getDecryptedAccessToken(shop)).toBe('shpat_abc');
      expect(encryptionService.decrypt).toHaveBeenCalledWith('enc(shpat_abc)');
    });
  });
});
