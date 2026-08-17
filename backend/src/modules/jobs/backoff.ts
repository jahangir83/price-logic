/**
 * Retry backoff for failed jobs.
 *
 * Server-only, so it lives here rather than in `@pricelogic/shared` — that
 * package is the contract with the admin UI, not a place to put utilities the
 * browser never runs.
 *
 * Pure and injectable-random so it can be tested without a clock.
 */

export interface BackoffOptions {
  /** Delay after the first failure. */
  baseMs?: number;
  /** Ceiling, so a repeatedly failing job settles instead of retreating forever. */
  maxMs?: number;
  /**
   * Fraction of the delay that is randomised, 0–1.
   *
   * Without this, every job that failed in the same Shopify throttle window
   * retries in the same millisecond and throttles again together. Jitter is
   * what breaks up that convoy.
   */
  jitter?: number;
  /** Injectable for tests. Defaults to `Math.random`. */
  random?: () => number;
}

const DEFAULTS = {
  baseMs: 5_000,
  maxMs: 15 * 60_000,
  jitter: 0.2,
} as const;

/**
 * Delay in milliseconds before attempt number `attempt` may run again.
 *
 * `attempt` is 1-based and is the number of attempts already made, so the
 * first failure yields roughly `baseMs`.
 */
export function computeBackoffMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  const baseMs = options.baseMs ?? DEFAULTS.baseMs;
  const maxMs = options.maxMs ?? DEFAULTS.maxMs;
  const jitter = options.jitter ?? DEFAULTS.jitter;
  const random = options.random ?? Math.random;

  const safeAttempt = Math.max(1, Math.floor(attempt));
  // Exponent is capped before the shift so the doubling cannot overflow into
  // Infinity on a job that has failed hundreds of times.
  const exponent = Math.min(safeAttempt - 1, 30);
  const uncapped = baseMs * 2 ** exponent;
  const capped = Math.min(uncapped, maxMs);

  // Jitter pulls the delay down rather than up, so `maxMs` stays a real cap.
  const spread = capped * jitter;
  return Math.round(capped - spread * random());
}

/** The instant a job that has failed `attempt` times may next be claimed. */
export function nextRunAtFor(
  attempt: number,
  now: Date = new Date(),
  options: BackoffOptions = {},
): Date {
  return new Date(now.getTime() + computeBackoffMs(attempt, options));
}
