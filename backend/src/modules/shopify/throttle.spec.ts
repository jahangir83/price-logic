import {
  ThrottleRegistry,
  ThrottleState,
  applyCost,
  initialState,
  projectedAvailable,
  reserve,
  waitMsFor,
} from './throttle';

const T0 = 1_700_000_000_000;

const state = (overrides: Partial<ThrottleState> = {}): ThrottleState => ({
  maximumAvailable: 1000,
  currentlyAvailable: 1000,
  restoreRate: 50,
  observedAt: T0,
  ...overrides,
});

describe('projectedAvailable', () => {
  it('refills at the restore rate', () => {
    const s = state({ currentlyAvailable: 100 });
    expect(projectedAvailable(s, T0)).toBe(100);
    expect(projectedAvailable(s, T0 + 1000)).toBe(150);
    expect(projectedAvailable(s, T0 + 4000)).toBe(300);
  });

  it('never exceeds the bucket size', () => {
    const s = state({ currentlyAvailable: 900 });
    expect(projectedAvailable(s, T0 + 60_000)).toBe(1000);
  });

  it('does not run backwards if the clock does', () => {
    const s = state({ currentlyAvailable: 500 });
    expect(projectedAvailable(s, T0 - 5000)).toBe(500);
  });
});

describe('waitMsFor', () => {
  it('does not wait when the query already fits', () => {
    expect(waitMsFor(state({ currentlyAvailable: 500 }), 100, T0)).toBe(0);
  });

  it('waits exactly long enough for the missing points', () => {
    // 20 short at 50/second = 400ms.
    expect(waitMsFor(state({ currentlyAvailable: 80 }), 100, T0)).toBe(400);
  });

  it('accounts for the refill that happened since the last response', () => {
    const s = state({ currentlyAvailable: 0 });
    // A second has passed, so 50 points are back and only 50 are missing.
    expect(waitMsFor(s, 100, T0 + 1000)).toBe(1000);
  });

  it('caps a query larger than the bucket instead of waiting forever', () => {
    // 5000 points can never be available at once; wait for a full bucket and
    // let Shopify return a real error, which is more useful than hanging.
    const s = state({ currentlyAvailable: 0 });
    expect(waitMsFor(s, 5000, T0)).toBe(20_000);
  });

  it('does not divide by zero when the restore rate is missing', () => {
    expect(
      waitMsFor(state({ restoreRate: 0, currentlyAvailable: 0 }), 100, T0),
    ).toBe(0);
  });
});

describe('reserve', () => {
  it('deducts optimistically so concurrent queries do not all see a full bucket', () => {
    // Without this, three in-flight queries each read "1000 available" and
    // burst straight through the limit together.
    let s = state();
    s = reserve(s, 400, T0);
    expect(s.currentlyAvailable).toBe(600);
    s = reserve(s, 400, T0);
    expect(s.currentlyAvailable).toBe(200);
  });

  it('never goes negative', () => {
    expect(
      reserve(state({ currentlyAvailable: 10 }), 500, T0).currentlyAvailable,
    ).toBe(0);
  });

  it('credits the refill before deducting', () => {
    const s = reserve(state({ currentlyAvailable: 0 }), 50, T0 + 2000);
    expect(s.currentlyAvailable).toBe(50);
  });
});

describe('applyCost', () => {
  it('replaces the estimate with what Shopify reported', () => {
    const s = applyCost(
      { maximumAvailable: 2000, currentlyAvailable: 137, restoreRate: 100 },
      T0,
    );
    expect(s).toEqual({
      maximumAvailable: 2000,
      currentlyAvailable: 137,
      restoreRate: 100,
      observedAt: T0,
    });
  });
});

describe('ThrottleRegistry', () => {
  it('assumes a full bucket for a shop it has never called', () => {
    const registry = new ThrottleRegistry();
    expect(registry.waitMs('shop-1', 900, T0)).toBe(0);
  });

  it('keeps shops independent', () => {
    const registry = new ThrottleRegistry();
    registry.observe(
      'shop-1',
      { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 50 },
      T0,
    );
    expect(registry.waitMs('shop-1', 100, T0)).toBe(2000);
    // One merchant exhausting their bucket must not slow another down.
    expect(registry.waitMs('shop-2', 100, T0)).toBe(0);
  });

  it('starts throttling once a shop reports a low bucket', () => {
    const registry = new ThrottleRegistry();
    registry.observe(
      'shop-1',
      { maximumAvailable: 1000, currentlyAvailable: 10, restoreRate: 50 },
      T0,
    );
    expect(registry.waitMs('shop-1', 110, T0)).toBe(2000);
  });

  it('forgets a shop on request', () => {
    const registry = new ThrottleRegistry();
    registry.observe(
      'shop-1',
      { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 50 },
      T0,
    );
    registry.forget('shop-1');
    expect(registry.waitMs('shop-1', 900, T0)).toBe(0);
  });

  it('defaults to the documented 1000 points at 50/second', () => {
    expect(initialState(T0)).toEqual({
      maximumAvailable: 1000,
      currentlyAvailable: 1000,
      restoreRate: 50,
      observedAt: T0,
    });
  });
});
