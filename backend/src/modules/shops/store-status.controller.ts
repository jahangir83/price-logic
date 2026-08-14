import { Controller, Get, Query } from '@nestjs/common';
import { ShopStatus } from '@pricelogic/shared';
import { ShopsService } from './shops.service';

export interface InstallationStatusResponse {
  installed: boolean;
  /** Where the frontend should send the merchant when `installed` is false. */
  authUrl: string | null;
}

/**
 * "Is this shop installed?" — asked by the frontend before it boots.
 *
 * **Deliberately unauthenticated.** It is asked *before* a session exists, by
 * an app the merchant may never have installed, so requiring auth would make
 * it unanswerable. It is safe because it leaks nothing: the only input is a
 * shop domain the caller already typed, and the only output is a boolean about
 * an app anyone can see in the Shopify app store.
 *
 * A shop that installed and later uninstalled answers **false** — its row
 * survives with status DISCONNECTED so its campaign history is still there
 * when it reinstalls, but its token no longer works, so it needs OAuth again.
 */
@Controller('store')
export class StoreStatusController {
  constructor(private readonly shops: ShopsService) {}

  @Get('check-installation')
  async checkInstallation(
    @Query('shop') shop?: string,
    @Query('host') host?: string,
  ): Promise<InstallationStatusResponse> {
    if (!shop || !isShopDomain(shop)) {
      // A malformed domain is "not installed" rather than an error: the
      // frontend's only useful response either way is to start OAuth, and
      // Shopify will reject a bad domain there with a better message than we
      // can give here.
      return { installed: false, authUrl: null };
    }

    const record = await this.shops.findByDomain(shop);
    const installed = record?.status === ShopStatus.ACTIVE;

    return {
      installed,
      authUrl: installed ? null : buildAuthPath(shop, host),
    };
  }
}

/** Shopify's own shape for a store domain. */
function isShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

/**
 * The path the frontend should send the **top frame** to.
 *
 * Relative, so it works behind whatever tunnel or domain the app is served
 * from without this endpoint having to know. `host` is carried through the
 * round trip because App Bridge needs it to re-embed the app afterwards, and
 * it is lost otherwise.
 */
function buildAuthPath(shop: string, host?: string): string {
  const params = new URLSearchParams({ shop });
  if (host) params.set('host', host);
  return `/auth?${params.toString()}`;
}
