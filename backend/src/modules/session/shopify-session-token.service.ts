import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** The claims Shopify puts in a session token. */
interface SessionTokenClaims {
  /** `https://shop.myshopify.com/admin` */
  iss?: string;
  /** `https://shop.myshopify.com` — the store the request is for. */
  dest?: string;
  /** Our app's client ID. */
  aud?: string;
  /** The Shopify user viewing the app. */
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  /** Stable per browser session; useful for correlating logs. */
  sid?: string;
}

/** What a caller gets back once the token has survived every check. */
export interface VerifiedSessionToken {
  shopDomain: string;
  /** Shopify's user id — the staff member, not the shop. */
  userId: string | null;
  sessionId: string | null;
  expiresAt: Date;
}

/**
 * Verifies the session token App Bridge hands the frontend.
 *
 * This is how an **embedded** app authenticates. The cookie the OAuth callback
 * sets cannot be relied on inside Shopify's iframe: it is a third-party cookie
 * there, and every current browser either partitions or blocks it outright. A
 * session token has no such problem — the frontend asks App Bridge for one and
 * puts it in an `Authorization` header, which nothing partitions.
 *
 * The token is a JWT signed by **Shopify** with our client secret, so verifying
 * it proves two things at once: Shopify issued it, and it was issued to *this*
 * app. It lives about a minute, which is why the frontend fetches a fresh one
 * per request rather than storing one.
 *
 * ## What is checked, and why each check matters
 *
 * | Check | What it stops |
 * | --- | --- |
 * | HS256 signature with the client secret | a forged token |
 * | `algorithms: ['HS256']` pinned | the `alg: none` and RS256-confusion attacks |
 * | `exp` / `nbf` | a replayed token from an old session |
 * | `aud` === our API key | a valid token *for another app* being reused here |
 * | `dest` host === `iss` host | a token minted for shop A naming shop B as its destination |
 * | `dest` is a myshopify domain | a hostile `dest` steering the shop lookup |
 *
 * The `aud` check is the one that is easy to omit and expensive to omit. Any
 * app on the platform can obtain a token for a shop it is installed on; without
 * `aud`, presenting that token here would authenticate as that shop.
 */
@Injectable()
export class ShopifySessionTokenService {
  private readonly logger = new Logger(ShopifySessionTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  verify(token: string): VerifiedSessionToken {
    const claims = this.decode(token);

    const audience = this.configService.get<string>('shopify.apiKey');
    if (!claims.aud || claims.aud !== audience) {
      // A token for a different app. Logged because in practice it means a
      // misconfigured API key far more often than it means an attack.
      this.logger.warn(
        `Session token rejected: aud ${claims.aud ?? '(none)'} is not this app`,
      );
      throw new UnauthorizedException(
        'Session token was issued to another app',
      );
    }

    const destHost = hostOf(claims.dest);
    const issHost = hostOf(claims.iss);
    if (!destHost || !issHost || destHost !== issHost) {
      throw new UnauthorizedException(
        'Session token destination is inconsistent',
      );
    }
    if (!isShopDomain(destHost)) {
      throw new UnauthorizedException(
        'Session token destination is not a shop',
      );
    }

    return {
      shopDomain: destHost,
      userId: claims.sub ?? null,
      sessionId: claims.sid ?? null,
      expiresAt: new Date((claims.exp ?? 0) * 1000),
    };
  }

  /**
   * Signature, `exp` and `nbf` in one step.
   *
   * The secret is passed per call rather than configured on the module: the
   * same `JwtService` also signs our own session cookie, and that uses a
   * different secret. Sharing one would mean a token we minted could be
   * presented as one Shopify minted, and the other way round.
   */
  private decode(token: string): SessionTokenClaims {
    const secret = this.configService.get<string>('shopify.clientSecret');
    try {
      return this.jwtService.verify<SessionTokenClaims>(token, {
        secret,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Session token is invalid or expired');
    }
  }
}

/** The hostname out of `https://shop.myshopify.com/admin`, or null. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function isShopDomain(host: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host);
}
