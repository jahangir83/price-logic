import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenExchangeResult {
  accessToken: string;
  scope: string;
}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * The only place in the app that talks to Shopify's OAuth endpoints
 * directly. Controllers must go through ShopifyAuthService, which in turn
 * calls this — never call `fetch` against Shopify from a controller.
 */
@Injectable()
export class ShopifyOAuthService {
  constructor(private readonly configService: ConfigService) {}

  isValidShopDomain(shop: string): boolean {
    return SHOP_DOMAIN_PATTERN.test(shop);
  }

  buildAuthorizeUrl(shop: string, state: string): string {
    const apiKey = this.configService.get<string>('shopify.apiKey');
    const scopes = this.configService.get<string>('shopify.scopes');
    const appUrl = this.configService.get<string>('shopify.appUrl');

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', apiKey as string);
    url.searchParams.set('scope', scopes as string);
    url.searchParams.set('redirect_uri', `${appUrl}/auth/callback`);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * Verifies the HMAC Shopify attaches to every OAuth callback query string,
   * per https://shopify.dev/docs/apps/auth/oauth#verify-a-request. Uses a
   * constant-time comparison to avoid timing attacks.
   */
  verifyHmac(query: Record<string, string>): boolean {
    const { hmac, ...rest } = query;
    if (!hmac) return false;

    const message = Object.keys(rest)
      .sort()
      .map((key) => `${key}=${rest[key]}`)
      .join('&');

    const secret = this.configService.get<string>('shopify.clientSecret');
    const computed = createHmac('sha256', secret as string)
      .update(message)
      .digest('hex');

    const computedBuf = Buffer.from(computed, 'utf8');
    const providedBuf = Buffer.from(hmac, 'utf8');
    if (computedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(computedBuf, providedBuf);
  }

  async fetchShopIdentity(
    shop: string,
    accessToken: string,
  ): Promise<{ shopifyShopId: string; currency: string; timezone: string }> {
    const apiVersion = this.configService.get<string>('shopify.apiVersion');
    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/shop.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch shop identity: status ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      shop: { id: number; currency: string; iana_timezone: string };
    };
    return {
      shopifyShopId: String(body.shop.id),
      currency: body.shop.currency,
      timezone: body.shop.iana_timezone,
    };
  }

  async exchangeCodeForToken(
    shop: string,
    code: string,
  ): Promise<TokenExchangeResult> {
    const apiKey = this.configService.get<string>('shopify.apiKey');
    const clientSecret = this.configService.get<string>('shopify.clientSecret');

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Shopify token exchange failed with status ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      access_token: string;
      scope: string;
    };
    return { accessToken: body.access_token, scope: body.scope };
  }
}
