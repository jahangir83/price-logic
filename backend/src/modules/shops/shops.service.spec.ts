import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { InitializationStatus, Shop, ShopStatus } from './entities/shop.entity';
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
          initializationStatus: InitializationStatus.NOT_STARTED,
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
        defaultSettings: {},
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
  });

  describe('getDecryptedAccessToken', () => {
    it('delegates to the encryption service', () => {
      const shop = { accessTokenEncrypted: 'enc(shpat_abc)' } as Shop;
      expect(service.getDecryptedAccessToken(shop)).toBe('shpat_abc');
      expect(encryptionService.decrypt).toHaveBeenCalledWith('enc(shpat_abc)');
    });
  });
});
