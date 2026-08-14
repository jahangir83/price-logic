import { DuplicatePolicy } from '../domain/campaign.js';
import {
  effectiveDuplicatePolicy,
  resolveAfterRelease,
  resolveOverlap,
  type VariantClaim,
} from './overlap.js';

const claim = (
  campaignId: string,
  newPrice: string,
  activatedAt: Date | null = null,
): VariantClaim => ({
  campaignId,
  jobId: `job-${campaignId}`,
  newPrice,
  newCompareAtPrice: null,
  activatedAt,
});

describe('effectiveDuplicatePolicy', () => {
  it('prefers the campaign override over the shop setting', () => {
    expect(
      effectiveDuplicatePolicy(DuplicatePolicy.SKIP, DuplicatePolicy.LATEST),
    ).toBe(DuplicatePolicy.LATEST);
  });

  it('falls back to the shop setting when the campaign has none', () => {
    expect(effectiveDuplicatePolicy(DuplicatePolicy.SKIP, null)).toBe(
      DuplicatePolicy.SKIP,
    );
  });

  it('defaults to largest-discount-wins when neither is set', () => {
    expect(effectiveDuplicatePolicy(null, null)).toBe(
      DuplicatePolicy.HIGHEST_DISCOUNT,
    );
  });
});

describe('resolveOverlap', () => {
  it('leaves an unclaimed variant alone', () => {
    expect(resolveOverlap([])).toEqual({
      winner: null,
      displaced: [],
      contested: false,
    });
  });

  it('is not contested with a single claim, whatever the policy', () => {
    const only = claim('a', '80.00');
    for (const policy of Object.values(DuplicatePolicy)) {
      const result = resolveOverlap([only], policy);
      expect(result.winner).toBe(only);
      expect(result.contested).toBe(false);
    }
  });

  it('gives the variant to the biggest discount', () => {
    const result = resolveOverlap(
      [claim('a', '80.00'), claim('b', '70.00'), claim('c', '90.00')],
      DuplicatePolicy.HIGHEST_DISCOUNT,
    );
    expect(result.winner?.campaignId).toBe('b');
    expect(result.displaced.map((c) => c.campaignId)).toEqual(['a', 'c']);
    expect(result.contested).toBe(true);
  });

  it('does not depend on input order', () => {
    const claims = [claim('a', '80.00'), claim('b', '70.00')];
    const forward = resolveOverlap(claims, DuplicatePolicy.HIGHEST_DISCOUNT);
    const reversed = resolveOverlap(
      [...claims].reverse(),
      DuplicatePolicy.HIGHEST_DISCOUNT,
    );
    expect(forward.winner?.campaignId).toBe(reversed.winner?.campaignId);
  });

  it('breaks a price tie deterministically', () => {
    const result = resolveOverlap(
      [claim('a', '70.00'), claim('b', '70.0000')],
      DuplicatePolicy.HIGHEST_DISCOUNT,
    );
    expect(result.winner?.campaignId).toBe('a');
  });

  it('gives the variant to the most recent campaign under LATEST', () => {
    const result = resolveOverlap(
      [
        claim('a', '70.00', new Date('2026-08-01T00:00:00Z')),
        claim('b', '90.00', new Date('2026-08-10T00:00:00Z')),
      ],
      DuplicatePolicy.LATEST,
    );
    // Deliberately the *worse* price — that is what LATEST means.
    expect(result.winner?.campaignId).toBe('b');
  });

  it('touches nothing under SKIP', () => {
    const result = resolveOverlap(
      [claim('a', '80.00'), claim('b', '70.00')],
      DuplicatePolicy.SKIP,
    );
    expect(result.winner).toBeNull();
    expect(result.displaced).toHaveLength(2);
    expect(result.contested).toBe(true);
  });
});

describe('resolveAfterRelease', () => {
  it('restores the original price when nobody else claims the variant', () => {
    const result = resolveAfterRelease([], '100.00', '150.00');
    expect(result).toEqual({
      price: '100.00',
      compareAtPrice: '150.00',
      restoredOriginal: true,
    });
  });

  it('does not un-discount a variant another campaign still owns', () => {
    // The bug blind reverting causes: A (20% off) ends while B (30% off) is
    // still running. Restoring A's stored original would put the variant back
    // to full price while B is still advertising it as on sale.
    const stillActive = claim('b', '70.00');
    const result = resolveAfterRelease([stillActive], '100.00', null);
    expect(result.price).toBe('70.00');
    expect(result.restoredOriginal).toBe(false);
  });

  it('re-resolves among several survivors rather than picking arbitrarily', () => {
    const result = resolveAfterRelease(
      [claim('b', '90.00'), claim('c', '75.00')],
      '100.00',
      null,
      DuplicatePolicy.HIGHEST_DISCOUNT,
    );
    expect(result.price).toBe('75.00');
  });

  it('restores the original under SKIP, since no survivor may claim it', () => {
    const result = resolveAfterRelease(
      [claim('b', '90.00'), claim('c', '75.00')],
      '100.00',
      null,
      DuplicatePolicy.SKIP,
    );
    expect(result.price).toBe('100.00');
    expect(result.restoredOriginal).toBe(true);
  });
});
