/**
 * Remembers that a shop is installed, for this browser.
 *
 * Saves a round trip on every subsequent load, which is the ~90% path. Only
 * ever caches `true`: a negative would be a promise we cannot keep, because a
 * shop that was uninstalled a second ago must still be sent to OAuth rather
 * than being told from cache that it is fine.
 *
 * Short-lived on purpose. A merchant who uninstalls and comes back should not
 * be stuck behind a stale yes for longer than it takes to make a cup of tea.
 */
const KEY = 'pricelogic:installed';
const TTL_MS = 30 * 60_000;

interface CacheEntry {
  shop: string;
  at: number;
}

export function readInstallCache(shop: string): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;

    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.shop !== shop) return false;
    return Date.now() - entry.at < TTL_MS;
  } catch {
    // Private browsing, a disabled storage API, corrupt JSON — all mean the
    // same thing here: ask the backend.
    return false;
  }
}

export function cacheInstalled(shop: string): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ shop, at: Date.now() } satisfies CacheEntry),
    );
  } catch {
    // Not being able to cache is not worth failing a boot over.
  }
}

export function clearInstallCache(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
