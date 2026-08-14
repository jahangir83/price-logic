/**
 * Shopify's Admin GraphQL rate limit is a **leaky bucket priced in query
 * cost**, not a request count.
 *
 * Every response reports how many points a query actually cost and how many
 * are left; the bucket refills at a fixed rate. So the correct behaviour is to
 * look at the last response, work out whether the next query fits, and wait if
 * it does not — rather than firing and reacting to a 429. Reacting is what
 * makes bulk work crawl: once you are throttled you have already lost the
 * points you were queued behind.
 *
 * Everything here is pure and takes `now` as an argument, so the behaviour can
 * be tested without sleeping.
 */

/** The `extensions.cost.throttleStatus` block Shopify returns on every call. */
export interface ShopifyThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  /** Points restored per second. */
  restoreRate: number;
}

export interface ShopifyCost {
  requestedQueryCost: number;
  actualQueryCost?: number | null;
  throttleStatus: ShopifyThrottleStatus;
}

/** What we last observed for one shop, and when. */
export interface ThrottleState extends ShopifyThrottleStatus {
  /** `Date.now()` at the moment the status was read. */
  observedAt: number;
}

/**
 * A shop we have never called. Optimistic on purpose: the standard bucket is
 * 1000 points at 50/second, and being wrong costs one retry, whereas assuming
 * an empty bucket would stall the first request of every session.
 */
export const DEFAULT_THROTTLE_STATE: Omit<ThrottleState, 'observedAt'> = {
  maximumAvailable: 1000,
  currentlyAvailable: 1000,
  restoreRate: 50,
};

export function initialState(now: number = Date.now()): ThrottleState {
  return { ...DEFAULT_THROTTLE_STATE, observedAt: now };
}

/** Points available at `now`, given the bucket has been refilling since. */
export function projectedAvailable(state: ThrottleState, now: number): number {
  const elapsedSeconds = Math.max(0, (now - state.observedAt) / 1000);
  return Math.min(
    state.maximumAvailable,
    state.currentlyAvailable + elapsedSeconds * state.restoreRate,
  );
}

/**
 * How long to wait before a query costing `cost` points can run.
 *
 * Returns 0 when it already fits. A query that costs more than the bucket can
 * ever hold would wait forever, so it is capped at a full refill — the caller
 * will get a real error from Shopify, which is more useful than hanging.
 */
export function waitMsFor(
  state: ThrottleState,
  cost: number,
  now: number = Date.now(),
): number {
  if (state.restoreRate <= 0) return 0;

  const affordable = Math.min(cost, state.maximumAvailable);
  const deficit = affordable - projectedAvailable(state, now);
  if (deficit <= 0) return 0;

  return Math.ceil((deficit / state.restoreRate) * 1000);
}

/** Fold a fresh `throttleStatus` into the state we keep for a shop. */
export function applyCost(
  status: ShopifyThrottleStatus,
  now: number = Date.now(),
): ThrottleState {
  return { ...status, observedAt: now };
}

/**
 * Spend points locally without waiting for a response.
 *
 * Needed because several queries can be in flight at once: if each only
 * updated the bucket when its own response arrived, they would all read the
 * same stale "plenty available" and burst straight through the limit.
 */
export function reserve(
  state: ThrottleState,
  cost: number,
  now: number = Date.now(),
): ThrottleState {
  return {
    ...state,
    currentlyAvailable: Math.max(0, projectedAvailable(state, now) - cost),
    observedAt: now,
  };
}

/**
 * Per-shop throttle bookkeeping.
 *
 * Deliberately in-memory and per-process. Two workers will each keep their own
 * view and can therefore overshoot together — which is what the retry on
 * THROTTLED is for. Sharing this across processes needs Redis and is not worth
 * it until there is more than one worker.
 */
export class ThrottleRegistry {
  private readonly states = new Map<string, ThrottleState>();

  get(shopId: string, now: number = Date.now()): ThrottleState {
    return this.states.get(shopId) ?? initialState(now);
  }

  /** Wait time for a query of this cost, given what we know about the shop. */
  waitMs(shopId: string, cost: number, now: number = Date.now()): number {
    return waitMsFor(this.get(shopId, now), cost, now);
  }

  /** Optimistically deduct a query's cost before sending it. */
  reserve(shopId: string, cost: number, now: number = Date.now()): void {
    this.states.set(shopId, reserve(this.get(shopId, now), cost, now));
  }

  /** Replace our estimate with what Shopify actually reported. */
  observe(
    shopId: string,
    status: ShopifyThrottleStatus,
    now: number = Date.now(),
  ): void {
    this.states.set(shopId, applyCost(status, now));
  }

  /** Drop a shop's state — on uninstall, or to reset between tests. */
  forget(shopId: string): void {
    this.states.delete(shopId);
  }

  clear(): void {
    this.states.clear();
  }
}
