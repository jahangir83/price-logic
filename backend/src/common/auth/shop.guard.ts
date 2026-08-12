import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ShopStatus } from '../../modules/shops/entities/shop.entity';
import { ShopsService } from '../../modules/shops/shops.service';
import { SessionAuthGuard } from './session-auth.guard';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Steps 2-3 of the authorization chain: Authorized? (shop is ACTIVE) and
 * Correct Shop? (the shop is resolved from the session — never from a
 * client-supplied id in params/body/query, so Shop A's session can never
 * act on Shop B's data by passing a different id).
 *
 * Runs SessionAuthGuard first (step 1: Authenticated?) so it can be used
 * standalone via `@UseGuards(ShopGuard)`.
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
    this.sessionAuthGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const shopId = request.session?.shopId;
    if (!shopId) {
      throw new UnauthorizedException('No session');
    }

    const shop = await this.shopsService.findById(shopId);
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
