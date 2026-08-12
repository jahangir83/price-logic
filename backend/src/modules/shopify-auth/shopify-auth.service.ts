import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../session/session.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { StoreInitService } from '../store-init/store-init.service';
import { ShopifyOAuthService } from './shopify-oauth.service';

export class OAuthFlowError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_shop'
      | 'missing_params'
      | 'state_mismatch'
      | 'invalid_hmac'
      | 'token_exchange_failed',
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class ShopifyAuthService {
  private readonly logger = new Logger(ShopifyAuthService.name);

  constructor(
    private readonly oauthService: ShopifyOAuthService,
    private readonly shopsService: ShopsService,
    private readonly sessionService: SessionService,
    private readonly storeInitService: StoreInitService,
  ) {}

  /** Step 1 of install: build the Shopify authorize redirect + a state nonce to store in a cookie. */
  beginInstall(shop: string): { redirectUrl: string; state: string } {
    if (!shop || !this.oauthService.isValidShopDomain(shop)) {
      throw new OAuthFlowError('invalid_shop', `Invalid shop domain: ${shop}`);
    }

    const state = randomUUID();
    const redirectUrl = this.oauthService.buildAuthorizeUrl(shop, state);
    return { redirectUrl, state };
  }

  /**
   * Step 2: handle the OAuth callback. Only creates/updates a Shop once
   * every verification step has passed — a failed handshake never leaves a
   * half-created Shop record behind.
   */
  async completeInstall(
    query: Record<string, string>,
    cookieState: string | undefined,
  ): Promise<{ shop: Shop; sessionToken: string }> {
    const { shop, code, state } = query;

    if (!shop || !code || !state) {
      throw new OAuthFlowError(
        'missing_params',
        'Missing OAuth callback parameters',
      );
    }
    if (!this.oauthService.isValidShopDomain(shop)) {
      throw new OAuthFlowError('invalid_shop', `Invalid shop domain: ${shop}`);
    }
    if (!cookieState || cookieState !== state) {
      throw new OAuthFlowError('state_mismatch', 'OAuth state does not match');
    }
    if (!this.oauthService.verifyHmac(query)) {
      throw new OAuthFlowError('invalid_hmac', 'HMAC verification failed');
    }

    let tokenResult;
    let identity;
    try {
      tokenResult = await this.oauthService.exchangeCodeForToken(shop, code);
      identity = await this.oauthService.fetchShopIdentity(
        shop,
        tokenResult.accessToken,
      );
    } catch (error) {
      this.logger.error('Shopify token exchange/identity fetch failed', error);
      throw new OAuthFlowError(
        'token_exchange_failed',
        'Failed to complete Shopify authorization',
      );
    }

    const savedShop = await this.shopsService.upsertFromInstall({
      shopifyShopId: identity.shopifyShopId,
      shopDomain: shop,
      accessToken: tokenResult.accessToken,
      currency: identity.currency,
      timezone: identity.timezone,
    });

    await this.storeInitService.initialize(savedShop);

    const sessionToken = this.sessionService.sign({ shopId: savedShop.id });
    return { shop: savedShop, sessionToken };
  }
}
