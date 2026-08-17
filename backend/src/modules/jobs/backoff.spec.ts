import { computeBackoffMs, nextRunAtFor } from './backoff';

// No jitter, so the shape of the curve is visible.
const exact = { jitter: 0, baseMs: 1000, maxMs: 60_000 };

describe('computeBackoffMs', () => {
  it('doubles with each attempt', () => {
    expect(computeBackoffMs(1, exact)).toBe(1000);
    expect(computeBackoffMs(2, exact)).toBe(2000);
    expect(computeBackoffMs(3, exact)).toBe(4000);
    expect(computeBackoffMs(4, exact)).toBe(8000);
  });

  it('stops at the ceiling', () => {
    expect(computeBackoffMs(20, exact)).toBe(60_000);
    expect(computeBackoffMs(500, exact)).toBe(60_000);
  });

  it('never returns Infinity or NaN, however many times a job has failed', () => {
    // 2 ** 1000 is Infinity; the exponent has to be capped before the shift.
    for (const attempt of [1, 50, 1000, Number.MAX_SAFE_INTEGER]) {
      const delay = computeBackoffMs(attempt, exact);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeLessThanOrEqual(60_000);
    }
  });

  it('treats a zero or negative attempt as the first one', () => {
    expect(computeBackoffMs(0, exact)).toBe(1000);
    expect(computeBackoffMs(-5, exact)).toBe(1000);
  });

  it('subtracts jitter rather than adding it, so the cap stays a cap', () => {
    const full = computeBackoffMs(20, {
      ...exact,
      jitter: 0.5,
      random: () => 1,
    });
    const none = computeBackoffMs(20, {
      ...exact,
      jitter: 0.5,
      random: () => 0,
    });
    expect(none).toBe(60_000);
    expect(full).toBe(30_000);
    expect(full).toBeLessThan(none);
  });

  it('spreads a convoy of jobs that failed in the same window', () => {
    // The point of jitter: 100 jobs throttled together must not all retry
    // in the same millisecond and throttle together again.
    const delays = new Set(
      Array.from({ length: 100 }, () =>
        computeBackoffMs(5, { baseMs: 1000, maxMs: 60_000, jitter: 0.2 }),
      ),
    );
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('nextRunAtFor', () => {
  it('offsets from the supplied clock', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    expect(nextRunAtFor(1, now, exact).toISOString()).toBe(
      '2026-08-14T12:00:01.000Z',
    );
  });
});
