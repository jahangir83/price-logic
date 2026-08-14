import type { Request } from 'express';
import type { Shop } from '../../modules/shops/entities/shop.entity';
import type { SessionPayload } from '../../modules/session/session.service';
import type { VerifiedSessionToken } from '../../modules/session/shopify-session-token.service';

export interface AuthenticatedRequest extends Request {
  /** Set by SessionAuthGuard once the session cookie is verified. */
  session?: SessionPayload;
  /** Set by ShopGuard once the session's shop is loaded and confirmed ACTIVE. */
  shop?: Shop;
  /**
   * Set by SessionAuthGuard when the request authenticated with an App Bridge
   * session token. Carries the Shopify user and session ids, which the cookie
   * path has no equivalent of — useful for logs, never for authorization.
   */
  sessionToken?: VerifiedSessionToken;
  /**
   * The shop SessionAuthGuard already had to load to resolve a session token.
   * An internal hand-off between the two guards so one request does not read
   * the same row twice; ShopGuard confirms the id before trusting it.
   */
  resolvedShop?: Shop;
}
