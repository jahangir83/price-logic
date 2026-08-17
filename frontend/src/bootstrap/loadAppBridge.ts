/**
 * Loads Shopify's App Bridge and waits for `window.shopify` to appear.
 *
 * **Must finish before React mounts.** App Bridge reads the global when a
 * component mounts, not when the module is imported, so mounting first gives
 * components a window without it and no second chance.
 *
 * Three details the script tag is fussy about:
 *
 * - App Bridge v4 refuses to initialise if its tag is `async`, `defer` or a
 *   module. A dynamically-created script defaults to `async = true`, so both
 *   have to be turned off *and* the attributes removed.
 * - The API key goes on `data-api-key`; there is no other way to pass it.
 * - `window.shopify` appears slightly after `onload`, so it is polled rather
 *   than assumed.
 *
 * Always resolves, never rejects. A failure to load App Bridge should give the
 * merchant a working non-embedded app, not a blank page.
 */
const APP_BRIDGE_SRC = 'https://cdn.shopify.com/shopifycloud/app-bridge.js';
const POLL_MS = 10;
const TIMEOUT_MS = 5000;

export function loadAppBridge(apiKey: string | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (hasAppBridge()) {
      resolve();
      return;
    }
    if (!apiKey) {
      console.warn('[app-bridge] No API key configured; running unembedded.');
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = APP_BRIDGE_SRC;
    script.setAttribute('data-api-key', apiKey);
    script.async = false;
    script.defer = false;
    script.removeAttribute('async');
    script.removeAttribute('defer');

    const startedAt = Date.now();
    const waitForGlobal = () => {
      if (hasAppBridge()) {
        resolve();
      } else if (Date.now() - startedAt > TIMEOUT_MS) {
        console.warn('[app-bridge] window.shopify never appeared.');
        resolve();
      } else {
        setTimeout(waitForGlobal, POLL_MS);
      }
    };

    script.onload = waitForGlobal;
    script.onerror = () => {
      console.warn('[app-bridge] Script failed to load; running unembedded.');
      resolve();
    };

    document.head.appendChild(script);
  });
}

function hasAppBridge(): boolean {
  return Boolean((window as unknown as { shopify?: unknown }).shopify);
}
