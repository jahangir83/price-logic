import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InitializationStatus,
  Shop,
  ShopStatus,
} from '../../modules/shops/entities/shop.entity';
import { ShopsService } from '../../modules/shops/shops.service';
import { SessionAuthGuard } from './session-auth.guard';
import { ShopGuard } from './shop.guard';

function contextForShop(shopId: string | undefined): ExecutionContext {
  const request: { session?: { shopId: string }; shop?: Shop } = {};
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    __request: request,
    __shopId: shopId,
  } as unknown as ExecutionContext;
}

describe('ShopGuard', () => {
  const activeShop: Shop = {
    id: 'shop-1',
    status: ShopStatus.ACTIVE,
    shopifyShopId: '1',
    shopDomain: 'my-store.myshopify.com',
    accessTokenEncrypted: 'enc',
    currency: 'USD',
    timezone: 'UTC',
    initializationStatus: InitializationStatus.COMPLETE,
    defaultSettings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeGuard(shopLookup: Shop | null) {
    const sessionAuthGuard = {
      canActivate: jest.fn((context: ExecutionContext) => {
        const request = context
          .switchToHttp()
          .getRequest<{ session?: unknown }>();
        request.session = { shopId: 'shop-1' };
        return true;
      }),
    } as unknown as SessionAuthGuard;
    const shopsService = {
      findById: jest.fn(() => Promise.resolve(shopLookup)),
    } as unknown as ShopsService;
    return new ShopGuard(sessionAuthGuard, shopsService);
  }

  it('attaches the shop to the request when it is ACTIVE', async () => {
    const guard = makeGuard(activeShop);
    const context = contextForShop('shop-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest<{ shop?: Shop }>().shop).toBe(
      activeShop,
    );
  });

  it('throws ForbiddenException when the shop is not ACTIVE', async () => {
    const guard = makeGuard({ ...activeShop, status: ShopStatus.SUSPENDED });
    await expect(guard.canActivate(contextForShop('shop-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws UnauthorizedException when the shop no longer exists', async () => {
    const guard = makeGuard(null);
    await expect(guard.canActivate(contextForShop('shop-1'))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
