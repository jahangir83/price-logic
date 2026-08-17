import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { ShopifyOAuthService } from './shopify-oauth.service';

const CONFIG: Record<string, string> = {
  'shopify.apiKey': 'test-api-key',
  'shopify.clientSecret': 'test-client-secret',
  'shopify.scopes': 'read_products,write_products',
  'shopify.appUrl': 'https://app.example.com',
  'shopify.apiVersion': '2025-01',
};

function makeService(): ShopifyOAuthService {
  const configService = {
    get: (key: string) => CONFIG[key],
  } as unknown as ConfigService;
  return new ShopifyOAuthService(configService);
}

describe('ShopifyOAuthService', () => {
  describe('isValidShopDomain', () => {
    it('accepts a well-formed myshopify.com domain', () => {
      expect(makeService().isValidShopDomain('my-store.myshopify.com')).toBe(
        true,
      );
    });

    it.each([
      'not-a-domain',
      'my-store.example.com',
      'https://my-store.myshopify.com',
      'MY-STORE.myshopify.com',
      '.myshopify.com',
    ])('rejects %s', (shop) => {
      expect(makeService().isValidShopDomain(shop)).toBe(false);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds a correct Shopify authorize URL', () => {
      const url = new URL(
        makeService().buildAuthorizeUrl('my-store.myshopify.com', 'nonce-1'),
      );
      expect(url.origin + url.pathname).toBe(
        'https://my-store.myshopify.com/admin/oauth/authorize',
      );
      expect(url.searchParams.get('client_id')).toBe('test-api-key');
      expect(url.searchParams.get('scope')).toBe(
        'read_products,write_products',
      );
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/auth/callback',
      );
      expect(url.searchParams.get('state')).toBe('nonce-1');
    });
  });

  describe('verifyHmac', () => {
    function sign(params: Record<string, string>): string {
      const message = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');
      return createHmac('sha256', CONFIG['shopify.clientSecret'])
        .update(message)
        .digest('hex');
    }

    it('accepts a correctly signed query', () => {
      const params = {
        shop: 'my-store.myshopify.com',
        code: 'abc',
        state: 'xyz',
      };
      const hmac = sign(params);
      expect(makeService().verifyHmac({ ...params, hmac })).toBe(true);
    });

    it('rejects a tampered query', () => {
      const params = {
        shop: 'my-store.myshopify.com',
        code: 'abc',
        state: 'xyz',
      };
      const hmac = sign(params);
      expect(
        makeService().verifyHmac({ ...params, code: 'tampered', hmac }),
      ).toBe(false);
    });

    it('rejects when hmac is missing', () => {
      expect(makeService().verifyHmac({ shop: 'my-store.myshopify.com' })).toBe(
        false,
      );
    });
  });
});
