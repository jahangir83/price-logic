import type { Serialized } from '../serialization.js';

export enum ProductTagChangeStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  FAILED = 'FAILED',
  REVERTED = 'REVERTED',
}

/**
 * The tag mutation a campaign actually performed on one product.
 *
 * A row exists **only when the product's tag set genuinely changed**, so
 * deactivation never strips a tag the merchant set themselves that happened
 * to match the campaign's. This is the constitution's rule in table form:
 * never reverse a side effect from configuration, reverse it from a record of
 * what was actually done.
 *
 * Tags are product-level in Shopify while prices are variant-level, which is
 * why this is keyed on a product rather than a variant.
 */
export interface ProductTagChange {
  id: string;
  shopId: string;
  campaignId: string;
  shopifyProductId: string;
  /** The complete tag set before the campaign touched it. */
  oldTags: string[];
  /** The complete tag set the campaign wrote. */
  newTags: string[];
  status: ProductTagChangeStatus;
  errorMessage: string | null;
  appliedAt: Date | null;
  revertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductTagChangeDto = Serialized<ProductTagChange>;

/**
 * Work out the tag set a campaign would write, given what a product carries
 * now. Returns null when nothing would change — the caller writes no row.
 *
 * Case-insensitive on match but preserves the merchant's own casing for tags
 * that survive, because Shopify treats tags case-insensitively for lookup
 * while still displaying whatever was stored.
 */
export function resolveTagChange(
  currentTags: readonly string[],
  addTags: readonly string[],
  removeTags: readonly string[],
): { oldTags: string[]; newTags: string[] } | null {
  const removeSet = new Set(removeTags.map((tag) => tag.toLowerCase()));
  const kept = currentTags.filter(
    (tag) => !removeSet.has(tag.toLowerCase()),
  );

  const presentSet = new Set(kept.map((tag) => tag.toLowerCase()));
  const added = addTags.filter((tag) => !presentSet.has(tag.toLowerCase()));

  const newTags = [...kept, ...added];
  const unchanged =
    newTags.length === currentTags.length &&
    newTags.every((tag, index) => tag === currentTags[index]);

  return unchanged ? null : { oldTags: [...currentTags], newTags };
}
