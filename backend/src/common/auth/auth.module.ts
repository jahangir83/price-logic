import { Module } from '@nestjs/common';
import { SessionModule } from '../../modules/session/session.module';
import { ShopsModule } from '../../modules/shops/shops.module';
import { SessionAuthGuard } from './session-auth.guard';
import { ShopGuard } from './shop.guard';

/**
 * `ShopsModule` and `SessionModule` are re-exported, not just imported.
 *
 * `ShopGuard` depends on `ShopsService`, so any module that uses the guard
 * needs that provider in scope. Exporting only the guard makes it resolve in
 * modules that happen to import `ShopsModule` for their own reasons and fail
 * at boot in the ones that do not — a dependency that travels with the guard
 * should not be something each consumer has to remember.
 */
@Module({
  imports: [SessionModule, ShopsModule],
  providers: [SessionAuthGuard, ShopGuard],
  exports: [SessionAuthGuard, ShopGuard, SessionModule, ShopsModule],
})
export class AuthModule {}
