import { checkInstallation } from './bootstrap/checkInstallation';
import { cacheInstalled, readInstallCache } from './bootstrap/installCache';
import { loadAppBridge } from './bootstrap/loadAppBridge';
import { renderMissingShop, renderRoot } from './bootstrap/renderRoot';
import { readShopParams } from './bootstrap/shopParams';
import { topNavigate } from './bootstrap/topNavigate';
import { API_URL } from './api/client';

/**
 * The boot gate. Nothing renders until this has decided what should.
 *
 * ```
 *  shop param? ──no──▶ "open from your admin"
 *      │yes
 *      ▼
 *  installed?  ──no──▶ top-frame redirect to backend /auth ──▶ Shopify OAuth
 *      │yes                                                        │
 *      ▼                                                     callback stores
 *  load App Bridge ──▶ render React                          token + session
 * ```
 *
 * The ordering is the whole point, and each step has to finish before the next:
 *
 * - **Install check before anything else.** Rendering first and discovering the
 *   401s later gives the merchant a flash of broken UI, and an OAuth redirect
 *   fired from a mounted React tree throws away whatever it was doing.
 * - **App Bridge before React.** It is read from the global when a component
 *   mounts, so a late load means the first render sees a window without it.
 *
 * Everything before `renderRoot` is deliberately outside React and outside the
 * router: this runs on a page that may have no session, and the app's own data
 * fetching all assumes one.
 */
async function boot(): Promise<void> {
  // The OAuth failure page is the one route that must render without a shop:
  // the backend redirects here precisely when it could not establish one, and
  // gating it behind the install check would replace the reason for the failure
  // with a generic "open from your admin".
  if (window.location.pathname.startsWith('/auth/error')) {
    renderRoot();
    return;
  }

  const { shop, host } = readShopParams();

  if (!shop) {
    renderMissingShop();
    return;
  }

  // The returning-merchant path: skip the round trip entirely.
  if (readInstallCache(shop)) {
    await start();
    return;
  }

  const status = await checkInstallation(shop, host);

  if (!status.installed) {
    // Out to Shopify. The backend owns the OAuth URL — scopes, state and the
    // redirect URI all live there, and duplicating them here is how they drift.
    topNavigate(`${API_URL}${status.authUrl ?? buildAuthPath(shop, host)}`);
    return;
  }

  cacheInstalled(shop);
  await start();
}

async function start(): Promise<void> {
  await loadAppBridge(import.meta.env.VITE_SHOPIFY_API_KEY as string | undefined);
  renderRoot();
}

function buildAuthPath(shop: string, host: string | null): string {
  const params = new URLSearchParams({ shop });
  if (host) params.set('host', host);
  return `/auth?${params.toString()}`;
}

void boot();
