import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../../modules/session/services/session.service';
import type {
  ShopifySessionTokenService,
  VerifiedSessionToken,
} from '../../modules/session/services/shopify-session-token.service';
import type { Shop } from '../../modules/shops/entities/shop.entity';
import type { ShopsService } from '../../modules/shops/services/shops.service';
import { SessionAuthGuard } from './session-auth.guard';
import type { AuthenticatedRequest } from './authenticated-request';

interface FakeRequest {
  cookies: Record<string, string>;
  headers: Record<string, string>;
  session?: unknown;
  sessionToken?: unknown;
  resolvedShop?: unknown;
}

function contextWith(request: Partial<FakeRequest>): ExecutionContext {
  const full: FakeRequest = {
    cookies: request.cookies ?? {},
    headers: request.headers ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => full }),
  } as unknown as ExecutionContext;
}

function requestOf(context: ExecutionContext): AuthenticatedRequest {
  return context.switchToHttp().getRequest<AuthenticatedRequest>();
}

describe('SessionAuthGuard', () => {
  const verified: VerifiedSessionToken = {
    shopDomain: 'demo.myshopify.com',
    userId: '42',
    sessionId: 'sid-1',
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const shop = { id: 'shop-1', shopDomain: 'demo.myshopify.com' } as Shop;

  let sessionService: { verify: jest.Mock };
  let shopifySessionToken: { verify: jest.Mock };
  let shopsService: { findByDomain: jest.Mock };
  let guard: SessionAuthGuard;

  beforeEach(() => {
    sessionService = { verify: jest.fn(() => ({ shopId: 'shop-cookie' })) };
    shopifySessionToken = { verify: jest.fn(() => verified) };
    shopsService = { findByDomain: jest.fn(() => Promise.resolve(shop)) };

    guard = new SessionAuthGuard(
      sessionService as unknown as SessionService,
      shopifySessionToken as unknown as ShopifySessionTokenService,
      shopsService as unknown as ShopsService,
    );
  });

  describe('session cookie', () => {
    it('attaches the verified session payload to the request', async () => {
      const context = contextWith({
        cookies: { [SESSION_COOKIE_NAME]: 'valid-token' },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(requestOf(context).session).toEqual({ shopId: 'shop-cookie' });
    });

    it('throws UnauthorizedException when no credential is present', async () => {
      await expect(guard.canActivate(contextWith({}))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('App Bridge session token', () => {
    it('resolves the shop from the token and attaches the session', async () => {
      const context = contextWith({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(shopifySessionToken.verify).toHaveBeenCalledWith('abc');
      expect(shopsService.findByDomain).toHaveBeenCalledWith(
        'demo.myshopify.com',
      );
      expect(requestOf(context).session).toEqual({ shopId: 'shop-1' });
      expect(requestOf(context).sessionToken).toBe(verified);
    });

    it('hands the loaded shop to ShopGuard so the row is read once', async () => {
      const context = contextWith({ headers: { authorization: 'Bearer abc' } });
      await guard.canActivate(context);

      expect(requestOf(context).resolvedShop).toBe(shop);
    });

    it('accepts the scheme in any case, as HTTP allows', async () => {
      const context = contextWith({ headers: { authorization: 'bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(shopifySessionToken.verify).toHaveBeenCalledWith('abc');
    });

    it('prefers the token over a cookie left from a previous install', async () => {
      // The stale-cookie case: the merchant reinstalled, and the cookie names a
      // shop row that is no longer the one they are looking at.
      const context = contextWith({
        headers: { authorization: 'Bearer abc' },
        cookies: { [SESSION_COOKIE_NAME]: 'stale' },
      });

      await guard.canActivate(context);

      expect(requestOf(context).session).toEqual({ shopId: 'shop-1' });
      expect(sessionService.verify).not.toHaveBeenCalled();
    });

    it('rejects a token for a shop with no install, with a code', async () => {
      // Genuine token, no install — the frontend needs to tell this apart from
      // an expired one, because only this case means "go and reinstall".
      shopsService.findByDomain.mockResolvedValue(null);
      const context = contextWith({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        response: { code: 'APP_NOT_INSTALLED' },
      });
    });

    it('lets a rejected token through as an error, never as a cookie fallback', async () => {
      // Falling back would turn a forged token into a successful request
      // whenever a cookie happened to be present.
      shopifySessionToken.verify.mockImplementation(() => {
        throw new UnauthorizedException('Session token is invalid or expired');
      });
      const context = contextWith({
        headers: { authorization: 'Bearer forged' },
        cookies: { [SESSION_COOKIE_NAME]: 'valid' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionService.verify).not.toHaveBeenCalled();
    });

    it('ignores an Authorization header that is not a Bearer token', async () => {
      const context = contextWith({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
        cookies: { [SESSION_COOKIE_NAME]: 'valid-token' },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(shopifySessionToken.verify).not.toHaveBeenCalled();
      expect(requestOf(context).session).toEqual({ shopId: 'shop-cookie' });
    });

    it('treats an empty Bearer value as no credential at all', async () => {
      const context = contextWith({ headers: { authorization: 'Bearer   ' } });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(shopifySessionToken.verify).not.toHaveBeenCalled();
    });
  });
});
