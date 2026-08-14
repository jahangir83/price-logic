import { Injectable } from '@nestjs/common';

/**
 * A short-lived, per-shop cache in front of the Shopify catalog.
 *
 * The app deliberately keeps no catalog table, so the campaign builder would
 * otherwise re-query Shopify for the same vendor list on every keystroke. TTLs
 * are graded by how fast the data actually changes.
 *
 * **Prices are never served from here for a write.** Phase 6 re-reads the
 * variant immediately before mutating it, because applying a discount to a
 * price that changed thirty seconds ago produces a wrong number that looks
 * right. `TTL.PRICES` exists only for rendering a preview.
 */
export const TTL = {
  /** Tags, vendors, product types — shop-wide and rarely edited. */
  FACETS_MS: 10 * 60_000,
  /** Product and collection search results. */
  SEARCH_MS: 60_000,
  /** Preview only. Never the source for a mutation. */
  PRICES_MS: 15_000,
} as const;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory rather than Redis: it is per-process and per-shop, and a cache
 * miss costs one Shopify call. Sharing it across processes only matters once
 * there is more than one, and that decision belongs with the broker.
 */
@Injectable()
export class ShopifyResponseCache {
  private readonly entries = new Map<string, Entry<unknown>>();

  private key(shopId: string, parts: readonly unknown[]): string {
    return `${shopId}:${JSON.stringify(parts)}`;
  }

  get<T>(
    shopId: string,
    parts: readonly unknown[],
    now = Date.now(),
  ): T | null {
    const key = this.key(shopId, parts);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(
    shopId: string,
    parts: readonly unknown[],
    value: T,
    ttlMs: number,
    now = Date.now(),
  ): void {
    this.entries.set(this.key(shopId, parts), {
      value,
      expiresAt: now + ttlMs,
    });
  }

  /** Read through, populating on a miss. */
  async wrap<T>(
    shopId: string,
    parts: readonly unknown[],
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(shopId, parts);
    if (cached !== null) return cached;

    const value = await load();
    this.set(shopId, parts, value, ttlMs);
    return value;
  }

  /** Drop everything for one shop — after an activation changes prices. */
  invalidateShop(shopId: string): void {
    const prefix = `${shopId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
