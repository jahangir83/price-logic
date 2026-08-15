/**
 * Getting the app back inside the Shopify admin.
 *
 * OAuth has to happen in the top frame, so the callback lands the merchant on a
 * plain top-level page — `/setup?shop=…&host=…` — with the admin nowhere in
 * sight. Loading App Bridge there accomplishes nothing: it talks to the admin
 * through the parent frame, and on a top-level page there is no parent. The
 * session token it is supposed to mint never arrives, so every API call falls
 * back to the cookie and the merchant sees a bare app with no admin chrome
 * around it.
 *
 * The fix is to hand the page back to Shopify and let it frame the app itself.
 * Shopify forwards whatever path follows the app id, so the merchant lands on
 * the same route they were already headed for:
 *
 * ```
 *   /setup                                     (top-level, after OAuth)
 *     -> https://admin.shopify.com/store/acme/apps/<client-id>/setup
 *          -> frames https://<app>/setup?shop=…&host=…&embedded=1
 * ```
 */

/** `admin.shopify.com/store/acme` — what `host` decodes to today. */
const ADMIN_HOST = /^admin\.shopify\.com\/store\/[a-z0-9][a-z0-9-]*$/i;
/** `acme.myshopify.com/admin` — the older form, still issued in places. */
const LEGACY_HOST = /^[a-z0-9][a-z0-9-]*\.myshopify\.com\/admin$/i;
const SHOP_DOMAIN = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/i;

/** Whether this document is running inside a frame at all. */
export function isEmbedded(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // Reading `window.top` across origins can throw, and only a framed document
    // is in a position to throw it.
    return true;
  }
}

/**
 * The admin origin and store path carried by `host`, or null.
 *
 * `host` is base64 and arrives straight off the URL, so it is attacker-supplied
 * as far as this function is concerned — it decides a navigation target, and an
 * unvalidated one is an open redirect. Only the two shapes Shopify actually
 * issues are accepted; anything else is discarded rather than repaired.
 */
export function decodeHost(host: string | null | undefined): string | null {
  if (!host) return null;

  let decoded: string;
  try {
    // base64url, and Shopify does not always pad.
    decoded = atob(host.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }

  decoded = decoded.replace(/\/+$/, '');
  return ADMIN_HOST.test(decoded) || LEGACY_HOST.test(decoded)
    ? decoded
    : null;
}

/**
 * Where this shop's admin serves this app, or null if it cannot be worked out.
 *
 * `host` is preferred because Shopify issued it. `shop` is the fallback for a
 * load that never had one — a bookmarked URL, a refresh that dropped the query
 * — and it reconstructs the same address, since the store handle is just the
 * myshopify subdomain.
 */
export function adminAppUrl(
  { host, shop }: { host: string | null; shop: string | null },
  apiKey: string | undefined,
  path = '',
): string | null {
  if (!apiKey) return null;

  const base = decodeHost(host) ?? storeHostFromShop(shop);
  if (!base) return null;

  const suffix = path === '/' ? '' : path;
  return `https://${base}/apps/${encodeURIComponent(apiKey)}${suffix}`;
}

function storeHostFromShop(shop: string | null): string | null {
  const match = SHOP_DOMAIN.exec(shop ?? '');
  return match ? `admin.shopify.com/store/${match[1].toLowerCase()}` : null;
}

/**
 * Sends a top-level page back into the admin. Returns true if it navigated, in
 * which case the caller must stop — the document is on its way out.
 *
 * Does nothing when already framed, which is what makes this loop-free: the
 * admin loads the app in an iframe, and inside that iframe `isEmbedded()` is
 * true, so the second pass falls straight through to booting normally.
 *
 * A page that cannot work out where to go renders where it is. Non-embedded is
 * a worse experience, not a broken one — the session cookie still authenticates
 * it, because a top-level page is first-party.
 */
export function ensureEmbedded(
  params: { host: string | null; shop: string | null },
  apiKey: string | undefined,
): boolean {
  if (isEmbedded()) return false;

  const url = adminAppUrl(params, apiKey, window.location.pathname);
  if (!url) {
    console.warn('[embed] No host or shop to re-embed with; staying top-level.');
    return false;
  }

  // `replace` rather than `assign`: the OAuth callback is already in the back
  // stack, and a merchant who hits Back should not be sent through it again.
  window.location.replace(url);
  return true;
}
