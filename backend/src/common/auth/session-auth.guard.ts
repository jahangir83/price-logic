import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../../modules/session/session.service';
import { ShopifySessionTokenService } from '../../modules/session/shopify-session-token.service';
import { ShopsService } from '../../modules/shops/shops.service';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Step 1 of the authorization chain: Authenticated?
 *
 * Two credentials are accepted, in this order:
 *
 * 1. **`Authorization: Bearer <session token>`** — an App Bridge session token,
 *    which is how the embedded app authenticates. Preferred because it is the
 *    only credential that survives inside Shopify's iframe, where our own
 *    cookie is a third-party cookie and is partitioned or blocked outright.
 * 2. **The session cookie** — set by the OAuth callback. Still the credential
 *    for anything running outside the iframe: the post-install landing, and a
 *    browser tab a merchant opened the app in directly.
 *
 * The header is checked first so that a stale cookie left over from a previous
 * install can never win over a token Shopify minted seconds ago.
 *
 * Whichever credential is used, the shop is derived from it and never from the
 * request — a client-supplied shop id is not an identity.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly shopifySessionToken: ShopifySessionTokenService,
    private readonly shopsService: ShopsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const bearer = bearerToken(request.headers.authorization);
    if (bearer) {
      await this.authenticateWithSessionToken(request, bearer);
      return true;
    }

    const cookie = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE_NAME
    ];
    if (!cookie) {
      throw new UnauthorizedException('No session');
    }

    request.session = this.sessionService.verify(cookie);
    return true;
  }

  private async authenticateWithSessionToken(
    request: AuthenticatedRequest,
    token: string,
  ): Promise<void> {
    const verified = this.shopifySessionToken.verify(token);
    const shop = await this.shopsService.findByDomain(verified.shopDomain);

    if (!shop) {
      // The token is genuine — Shopify signed it — but we have no install for
      // this shop. That is the reinstall case, and the frontend can only act on
      // it if it can tell this apart from an expired token, so it gets a code
      // rather than a bare 401.
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'APP_NOT_INSTALLED',
        message: `${verified.shopDomain} has no install of this app`,
      });
    }

    request.session = { shopId: shop.id };
    request.sessionToken = verified;
    // Handed to ShopGuard so the shop is loaded once per request rather than
    // once per guard. Safe because ShopGuard re-checks the id matches.
    request.resolvedShop = shop;
  }
}

/** The token out of `Authorization: Bearer <token>`, or null. */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
