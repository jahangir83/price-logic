/**
 * The App Bridge global, as far as this app uses it.
 *
 * Declared here rather than imported: App Bridge v4 is loaded from Shopify's
 * CDN at boot, not bundled, so there is no module to take types from.
 */
interface ShopifyGlobal {
  /** A fresh session token. Short-lived — about a minute. */
  idToken?: () => Promise<string>;
}

function appBridge(): ShopifyGlobal | undefined {
  return (window as unknown as { shopify?: ShopifyGlobal }).shopify;
}

/**
 * A session token for the current request, or null when there is none to be
 * had.
 *
 * **Fetched per request, never stored.** The token lives about a minute, and
 * App Bridge already keeps a valid one and refreshes it — caching it here would
 * only add a second, worse cache that can serve an expired token.
 *
 * Null means the app is running outside Shopify's iframe: the post-install
 * landing, or a tab the merchant opened directly. Those requests fall back to
 * the session cookie, which works because they are not third-party contexts.
 */
export async function getSessionToken(): Promise<string | null> {
  const bridge = appBridge();
  if (!bridge?.idToken) return null;

  try {
    return await bridge.idToken();
  } catch (error) {
    // App Bridge refuses when the merchant's Shopify session has gone. The
    // cookie fallback will not save this request, but a 401 carrying a reason
    // is a better outcome than a thrown error with none.
    console.warn('[session-token] App Bridge would not issue a token', error);
    return null;
  }
}

/** Whether the app is embedded and can authenticate with a session token. */
export function canUseSessionToken(): boolean {
  return typeof appBridge()?.idToken === 'function';
}
