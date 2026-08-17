import { checkInstallation } from './bootstrap/checkInstallation';
import { ensureEmbedded } from './bootstrap/embed';
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
 *  in a frame? ──no──▶ redirect into the admin ──┐            token + session
 *      │yes                                      │                 │
 *      │       ┌── Shopify frames the app ◀──────┘◀────────────────┘
 *      ▼       ▼
 *  load App Bridge ──▶ render React
 * ```
 *
 * The ordering is the whole point, and each step has to finish before the next:
 *
 * - **Install check before anything else.** Rendering first and discovering the
 *   401s later gives the merchant a flash of broken UI, and an OAuth redirect
 *   fired from a mounted React tree throws away whatever it was doing.
 * - **Re-embed before App Bridge.** App Bridge reaches the admin through the
 *   parent frame; started on a top-level page it has nothing to talk to.
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
    await start(shop, host);
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
  await start(shop, host);
}

async function start(shop: string, host: string | null): Promise<void> {
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY as string | undefined;

  // The OAuth callback drops the merchant on a top-level page, because that is
  // where OAuth had to happen. Loading App Bridge here would be pointless — it
  // reaches the admin through the parent frame, and there isn't one — so the
  // page hands itself back to Shopify and gets framed properly. Checked after
  // the install gate: re-embedding a shop that still needs OAuth just puts the
  // breakout back where it started.
  if (ensureEmbedded({ shop, host }, apiKey)) return;

  await loadAppBridge(apiKey);
  renderRoot();
}

function buildAuthPath(shop: string, host: string | null): string {
  const params = new URLSearchParams({ shop });
  if (host) params.set('host', host);
  return `/auth?${params.toString()}`;
}

void boot();
