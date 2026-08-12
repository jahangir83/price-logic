import type { Request } from 'express';
import type { Shop } from '../../modules/shops/entities/shop.entity';
import type { SessionPayload } from '../../modules/session/session.service';

export interface AuthenticatedRequest extends Request {
  /** Set by SessionAuthGuard once the session cookie is verified. */
  session?: SessionPayload;
  /** Set by ShopGuard once the session's shop is loaded and confirmed ACTIVE. */
  shop?: Shop;
}
