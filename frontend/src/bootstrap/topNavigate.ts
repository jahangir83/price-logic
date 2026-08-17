/**
 * Navigates the **top** browser frame, not the iframe the app runs in.
 *
 * Shopify's OAuth screen sets `X-Frame-Options`, so a plain
 * `window.location.assign` from inside the embedded iframe renders a blank
 * panel with a console error and no way forward. The redirect has to break out.
 *
 * Three routes out, in order of preference:
 *
 * 1. `window.top.location` — works when the frames are same-origin.
 * 2. An anchor with `target="_top"` — the cross-origin case, where reading
 *    `window.top.location` throws a SecurityError.
 * 3. A rendered "Continue" link the merchant clicks.
 *
 * The third is not paranoia. Browsers block a cross-origin iframe from
 * navigating the top frame without user activation, and they block it
 * *silently* — no exception, no console error the first two paths can catch.
 * On a cold load, which is exactly when the boot gate runs, there has been no
 * activation to spend. So we attempt the scripted navigation, then check
 * whether we are still here; a real click carries the activation that a script
 * cannot fake.
 */
const FALLBACK_DELAY_MS = 1200;

export function topNavigate(url: string): void {
  if (window.top === window.self) {
    window.location.assign(url);
    return;
  }

  try {
    if (window.top) {
      window.top.location.href = url;
    }
  } catch {
    // Cross-origin. The anchor below is the supported route.
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_top';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Still here means the browser dropped both attempts on the floor. Unloading
  // cancels the timer, so this only ever fires when the navigation did not
  // happen.
  window.setTimeout(() => renderContinueLink(url), FALLBACK_DELAY_MS);
}

/**
 * The last resort: ask the merchant to click.
 *
 * Plain DOM rather than React — this runs before the app has mounted, and the
 * whole point is to work when the automatic path did not.
 */
function renderContinueLink(url: string): void {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = `
    <main style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; color: #202223; line-height: 1.5;">
      <h1 style="font-size: 1.25rem; margin: 0 0 0.5rem;">Connect PriceLogic to your store</h1>
      <p style="margin: 0 0 1.5rem; color: #6d7175;">
        PriceLogic needs permission from Shopify before it can load.
      </p>
      <a id="plc-continue" href="${escapeAttribute(url)}" target="_top" rel="noopener"
         style="display: inline-block; background: #303030; color: #fff; text-decoration: none; padding: 0.6rem 1.1rem; border-radius: 0.5rem; font-weight: 500;">
        Continue to Shopify
      </a>
    </main>
  `;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
