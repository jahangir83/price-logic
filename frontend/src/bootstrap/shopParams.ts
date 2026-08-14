/**
 * Reads `shop` and `host` for this load.
 *
 * Shopify puts both on the URL every time it opens the app, but *only* on that
 * first load — a client-side route change drops them. They are therefore
 * mirrored into sessionStorage on the way past, so a merchant who lands deep in
 * the app after a refresh still boots.
 *
 * `host` is base64 and needed by App Bridge to re-embed the app; `shop` is the
 * myshopify domain and identifies the tenant.
 */
const SHOP_KEY = 'pricelogic:shop';
const HOST_KEY = 'pricelogic:host';

export interface ShopParams {
  shop: string | null;
  host: string | null;
}

export function readShopParams(): ShopParams {
  const query = new URLSearchParams(window.location.search);

  const shop = query.get('shop') ?? read(SHOP_KEY);
  const host = query.get('host') ?? read(HOST_KEY);

  if (shop) write(SHOP_KEY, shop);
  if (host) write(HOST_KEY, host);

  return { shop, host };
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
