import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Shop } from '../../modules/shops/entities/shop.entity';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

/**
 * Injects the Shop resolved by ShopGuard from the caller's session.
 * Only usable on routes guarded by ShopGuard (it throws otherwise) — this is
 * intentional: a handler with no CurrentShop() must not touch tenant data.
 */
export const CurrentShop = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Shop => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.shop) {
      throw new Error(
        'CurrentShop() used on a route without ShopGuard — every tenant-data route must apply ShopGuard first.',
      );
    }
    return request.shop;
  },
);
