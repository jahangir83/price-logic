/**
 * Navigates the **top** browser frame, not the iframe the app runs in.
 *
 * Shopify's OAuth screen sets `X-Frame-Options`, so a plain
 * `window.location.assign` from inside the embedded iframe renders a blank
 * panel with a console error and no way forward. The redirect has to break out.
 *
 * Two routes out, in order of preference:
 *
 * 1. `window.top.location` — works when the frames are same-origin, which they
 *    are during a local dev tunnel.
 * 2. A rendered anchor with `target="_top"` — works cross-origin, where reading
 *    `window.top.location` throws a SecurityError. Clicking a link is a user-ish
 *    gesture the browser allows where a scripted cross-origin assignment is not.
 */
export function topNavigate(url: string): void {
  if (window.top === window.self) {
    window.location.assign(url);
    return;
  }

  try {
    if (window.top) {
      window.top.location.href = url;
      return;
    }
  } catch {
    // Cross-origin. Fall through to the anchor.
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_top';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
}
