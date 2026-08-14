import {
  DEFAULT_DUPLICATE_POLICY,
  DuplicatePolicy,
} from '../domain/campaign.js';
import { compare, type Money } from '../money/money.js';

/**
 * Resolving a variant claimed by more than one active campaign.
 *
 * The policy itself is a domain choice and lives on the `Campaign` model; this
 * file only applies it. Both halves of the problem are here: which claim wins
 * while campaigns overlap ({@link resolveOverlap}), and what a variant's price
 * becomes when one of them releases it ({@link resolveAfterRelease}) — the
 * half that blind reverting gets wrong.
 */

/**
 * One campaign's claim on a variant — the price it wants the variant to have.
 */
export interface VariantClaim {
  campaignId: string;
  jobId: string;
  newPrice: Money;
  newCompareAtPrice: Money | null;
  /** When the claiming campaign was activated. Required for LATEST. */
  activatedAt: Date | null;
}

/** Which campaign's claim applies to a variant, and why the others did not. */
export interface OverlapResolution {
  /** Null means no campaign should touch this variant. */
  winner: VariantClaim | null;
  /** Claims that lost, so the caller can mark those rows SKIPPED. */
  displaced: VariantClaim[];
  contested: boolean;
}

/** Resolve the shop default against an optional per-campaign override. */
export function effectiveDuplicatePolicy(
  shopPolicy: DuplicatePolicy | null | undefined,
  campaignPolicy: DuplicatePolicy | null | undefined,
): DuplicatePolicy {
  return campaignPolicy ?? shopPolicy ?? DEFAULT_DUPLICATE_POLICY;
}

/**
 * Decide which claim applies to one variant.
 *
 * Pure and total: with a single claim every policy agrees, and with none the
 * answer is "leave it alone".
 */
export function resolveOverlap(
  claims: readonly VariantClaim[],
  policy: DuplicatePolicy = DEFAULT_DUPLICATE_POLICY,
): OverlapResolution {
  if (claims.length === 0) {
    return { winner: null, displaced: [], contested: false };
  }
  if (claims.length === 1) {
    return { winner: claims[0] ?? null, displaced: [], contested: false };
  }

  if (policy === DuplicatePolicy.SKIP) {
    return { winner: null, displaced: [...claims], contested: true };
  }

  const winner =
    policy === DuplicatePolicy.LATEST
      ? pickLatest(claims)
      : pickLowestPrice(claims);

  return {
    winner,
    displaced: claims.filter((claim) => claim !== winner),
    contested: true,
  };
}

function pickLowestPrice(claims: readonly VariantClaim[]): VariantClaim {
  return claims.reduce((best, claim) =>
    // Ties keep the earlier claim, so the result does not depend on input
    // order when two campaigns land on the same price.
    compare(claim.newPrice, best.newPrice) < 0 ? claim : best,
  );
}

function pickLatest(claims: readonly VariantClaim[]): VariantClaim {
  return claims.reduce((best, claim) => {
    const claimAt = claim.activatedAt?.getTime() ?? 0;
    const bestAt = best.activatedAt?.getTime() ?? 0;
    return claimAt > bestAt ? claim : best;
  });
}

/**
 * What a variant's price should become when one campaign releases it.
 *
 * This is the half of the overlap problem that blind reverting gets wrong.
 * Campaign A (20% off) is active; B (30% off) activates and overwrites the
 * price; A then ends. Restoring A's `oldPrice` would un-discount a variant
 * that B still owns and still advertises.
 *
 * So revert asks this instead: after removing the releasing campaign, does
 * anyone still claim the variant? If yes, the answer is that claim's price,
 * not the stored original.
 *
 * @param remainingClaims claims from campaigns still active, excluding the
 *   campaign being reverted
 * @param originalPrice the price to restore when nothing else claims it
 */
export function resolveAfterRelease(
  remainingClaims: readonly VariantClaim[],
  originalPrice: Money,
  originalCompareAtPrice: Money | null,
  policy: DuplicatePolicy = DEFAULT_DUPLICATE_POLICY,
): { price: Money; compareAtPrice: Money | null; restoredOriginal: boolean } {
  const { winner } = resolveOverlap(remainingClaims, policy);

  if (winner === null) {
    return {
      price: originalPrice,
      compareAtPrice: originalCompareAtPrice,
      restoredOriginal: true,
    };
  }

  return {
    price: winner.newPrice,
    compareAtPrice: winner.newCompareAtPrice,
    restoredOriginal: false,
  };
}
