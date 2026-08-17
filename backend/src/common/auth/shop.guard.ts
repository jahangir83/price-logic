import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ShopStatus } from '../../modules/shops/entities/shop.entity';
import { ShopsService } from '../../modules/shops/services/shops.service';
import { SessionAuthGuard } from './session-auth.guard';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Steps 2-3 of the authorization chain: Authorized? (shop is ACTIVE) and
 * Correct Shop? (the shop is resolved from the session — never from a
 * client-supplied id in params/body/query, so Shop A's session can never
 * act on Shop B's data by passing a different id).
 *
 * Runs SessionAuthGuard first (step 1: Authenticated?) so it can be used
 * standalone via `@UseGuards(ShopGuard)`. That guard accepts either an App
 * Bridge session token or the session cookie; by the time this one runs, the
 * difference no longer matters — there is a shopId either way.
 *
 * Step 4 (Allowed Action?) is a no-op extension point for now — the MVP
 * domain has no per-user roles/permissions yet, so every authenticated
 * request for an ACTIVE shop is allowed to act on that shop's data.
 */
@Injectable()
export class ShopGuard implements CanActivate {
  constructor(
    private readonly sessionAuthGuard: SessionAuthGuard,
    private readonly shopsService: ShopsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionAuthGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const shopId = request.session?.shopId;
    if (!shopId) {
      throw new UnauthorizedException('No session');
    }

    // Reuse the row SessionAuthGuard already loaded on the session-token path,
    // but only after confirming it is the shop the session actually names.
    const shop =
      request.resolvedShop?.id === shopId
        ? request.resolvedShop
        : await this.shopsService.findById(shopId);
    if (!shop) {
      throw new UnauthorizedException('Shop no longer exists');
    }
    if (shop.status !== ShopStatus.ACTIVE) {
      throw new ForbiddenException(
        `Shop is ${shop.status.toLowerCase()}, not active`,
      );
    }

    request.shop = shop;
    return true;
  }
}
