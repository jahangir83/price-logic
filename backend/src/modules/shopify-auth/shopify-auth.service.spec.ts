import { SessionService } from '../session/session.service';
import {
  InitializationStatus,
  Shop,
  ShopStatus,
} from '../shops/entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { WebhookRegistrarService } from '../shopify/webhook-registrar.service';
import { StoreInitService } from '../store-init/store-init.service';
import { OAuthFlowError, ShopifyAuthService } from './shopify-auth.service';
import { ShopifyOAuthService } from './shopify-oauth.service';

describe('ShopifyAuthService', () => {
  let oauthService: {
    isValidShopDomain: jest.Mock;
    buildAuthorizeUrl: jest.Mock;
    verifyHmac: jest.Mock;
    exchangeCodeForToken: jest.Mock;
    fetchShopIdentity: jest.Mock;
  };
  let shopsService: { upsertFromInstall: jest.Mock };
  let sessionService: { sign: jest.Mock };
  let storeInitService: { initialize: jest.Mock };
  let webhookRegistrar: { registerAll: jest.Mock };
  let service: ShopifyAuthService;

  const VALID_SHOP = 'my-store.myshopify.com';

  beforeEach(() => {
    oauthService = {
      isValidShopDomain: jest.fn((shop: string) => shop === VALID_SHOP),
      buildAuthorizeUrl: jest.fn(() => 'https://shopify.example/authorize'),
      verifyHmac: jest.fn(() => true),
      exchangeCodeForToken: jest.fn(() =>
        Promise.resolve({ accessToken: 'shpat_abc', scope: 'read_products' }),
      ),
      fetchShopIdentity: jest.fn(() =>
        Promise.resolve({
          shopifyShopId: '123',
          currency: 'USD',
          timezone: 'UTC',
        }),
      ),
    };
    shopsService = {
      upsertFromInstall: jest.fn(() =>
        Promise.resolve({
          id: 'shop-1',
          status: ShopStatus.ACTIVE,
          initializationStatus: InitializationStatus.NOT_STARTED,
        } as Shop),
      ),
    };
    sessionService = { sign: jest.fn(() => 'signed-jwt') };
    storeInitService = {
      initialize: jest.fn((shop: Shop) => Promise.resolve(shop)),
    };
    webhookRegistrar = {
      registerAll: jest.fn(() =>
        Promise.resolve({
          total: 5,
          registered: 5,
          alreadyPresent: 0,
          failed: [],
        }),
      ),
    };

    service = new ShopifyAuthService(
      oauthService as unknown as ShopifyOAuthService,
      shopsService as unknown as ShopsService,
      sessionService as unknown as SessionService,
      storeInitService as unknown as StoreInitService,
      webhookRegistrar as unknown as WebhookRegistrarService,
    );
  });

  describe('beginInstall', () => {
    it('returns a redirect URL and state for a valid shop', () => {
      const result = service.beginInstall(VALID_SHOP);
      expect(result.redirectUrl).toBe('https://shopify.example/authorize');
      expect(result.state).toEqual(expect.any(String));
    });

    it('rejects an invalid shop domain', () => {
      expect(() => service.beginInstall('not-a-shop')).toThrow(OAuthFlowError);
    });
  });

  describe('completeInstall', () => {
    const query = {
      shop: VALID_SHOP,
      code: 'code-1',
      state: 'state-1',
      hmac: 'h',
    };

    it('rejects when required params are missing', async () => {
      await expect(
        service.completeInstall({ shop: VALID_SHOP }, 'state-1'),
      ).rejects.toMatchObject({ reason: 'missing_params' });
    });

    it('rejects when the state cookie does not match', async () => {
      await expect(
        service.completeInstall(query, 'different-state'),
      ).rejects.toMatchObject({ reason: 'state_mismatch' });
    });

    it('rejects when HMAC verification fails', async () => {
      oauthService.verifyHmac.mockReturnValue(false);
      await expect(
        service.completeInstall(query, 'state-1'),
      ).rejects.toMatchObject({ reason: 'invalid_hmac' });
    });

    it('rejects when token exchange fails, without creating a Shop', async () => {
      oauthService.exchangeCodeForToken.mockRejectedValue(new Error('boom'));

      await expect(
        service.completeInstall(query, 'state-1'),
      ).rejects.toMatchObject({ reason: 'token_exchange_failed' });
      expect(shopsService.upsertFromInstall).not.toHaveBeenCalled();
    });

    it('creates/updates the Shop and returns a session token on success', async () => {
      const result = await service.completeInstall(query, 'state-1');

      expect(shopsService.upsertFromInstall).toHaveBeenCalledWith({
        shopifyShopId: '123',
        shopDomain: VALID_SHOP,
        accessToken: 'shpat_abc',
        currency: 'USD',
        timezone: 'UTC',
      });
      expect(storeInitService.initialize).toHaveBeenCalled();
      expect(sessionService.sign).toHaveBeenCalledWith({ shopId: 'shop-1' });
      expect(result.sessionToken).toBe('signed-jwt');
    });

    it('subscribes the shop to webhooks with the freshly exchanged token', async () => {
      // Install is the only moment we are certain to have a working token, and
      // a reinstall gets no subscriptions carried over — so it has to happen
      // here rather than lazily on first use.
      await service.completeInstall(query, 'state-1');

      expect(webhookRegistrar.registerAll).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'shop-1' }),
        'shpat_abc',
      );
    });

    it('still completes the install when webhook registration fails', async () => {
      // A merchant with a working app and one missing webhook is far better off
      // than one who cannot install at all.
      webhookRegistrar.registerAll.mockRejectedValue(new Error('Shopify down'));

      const result = await service.completeInstall(query, 'state-1');

      expect(result.sessionToken).toBe('signed-jwt');
      expect(shopsService.upsertFromInstall).toHaveBeenCalled();
    });
  });
});
