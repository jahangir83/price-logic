import {
  instantFromLocal,
  localFromInstant,
  localTimeExists,
  localTimeIsAmbiguous,
  zoneOffsetMs,
} from './timezone.js';

const NY = 'America/New_York';
const DHAKA = 'Asia/Dhaka';
const LONDON = 'Europe/London';

/*
 * US daylight time in 2026 runs from Sunday 8 March to Sunday 1 November.
 * Those two dates are where a scheduler quietly goes wrong, so they are the
 * dates every case below is built around.
 */

describe('zoneOffsetMs', () => {
  it('reads a standard-time offset', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-5 * 3_600_000);
  });

  it('reads a daylight-time offset', () => {
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-4 * 3_600_000);
  });

  it('handles a zone with a half-hour offset', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Asia/Kolkata')).toBe(
      5.5 * 3_600_000,
    );
  });

  it('is zero for UTC', () => {
    expect(zoneOffsetMs(new Date('2026-06-01T00:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('instantFromLocal', () => {
  it('resolves a winter morning in New York', () => {
    // 9am EST is 14:00Z.
    expect(instantFromLocal('2026-01-15T09:00', NY).toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('resolves a summer morning in New York', () => {
    // The same wall-clock 9am, an hour earlier in UTC. A campaign stored as a
    // fixed instant would drift by an hour across the boundary.
    expect(instantFromLocal('2026-07-15T09:00', NY).toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('resolves 9am on the spring-forward day itself', () => {
    // Clocks jumped at 02:00, so 9am is already daylight time.
    expect(instantFromLocal('2026-03-08T09:00', NY).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    );
  });

  it('resolves 9am on the fall-back day itself', () => {
    // Clocks went back at 02:00, so 9am is standard time again.
    expect(instantFromLocal('2026-11-01T09:00', NY).toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });

  it('resolves the hour before a spring-forward', () => {
    expect(instantFromLocal('2026-03-08T01:30', NY).toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
  });

  it('handles a zone with no DST at all', () => {
    expect(instantFromLocal('2026-07-15T09:00', DHAKA).toISOString()).toBe(
      '2026-07-15T03:00:00.000Z',
    );
    expect(instantFromLocal('2026-01-15T09:00', DHAKA).toISOString()).toBe(
      '2026-01-15T03:00:00.000Z',
    );
  });

  it('handles a southern-hemisphere zone, where the seasons invert', () => {
    // Sydney is UTC+11 in January and UTC+10 in July — the opposite way round
    // to New York, which is exactly the case a hardcoded offset gets wrong.
    const january = instantFromLocal('2026-01-15T09:00', 'Australia/Sydney');
    const july = instantFromLocal('2026-07-15T09:00', 'Australia/Sydney');
    expect(january.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(july.toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });

  it('accepts a space instead of a T, and seconds', () => {
    expect(instantFromLocal('2026-01-15 09:00', NY).toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
    expect(instantFromLocal('2026-01-15T09:00:30', NY).toISOString()).toBe(
      '2026-01-15T14:00:30.000Z',
    );
  });

  it('rejects something that is not a date-time', () => {
    expect(() => instantFromLocal('next tuesday', NY)).toThrow(RangeError);
  });
});

describe('round-tripping', () => {
  it.each([
    ['2026-01-15T09:00', NY],
    ['2026-07-15T09:00', NY],
    ['2026-03-08T09:00', NY],
    ['2026-11-01T09:00', NY],
    ['2026-06-15T14:30', LONDON],
    ['2026-12-25T00:00', DHAKA],
  ])('%s in %s survives a round trip', (local, zone) => {
    expect(localFromInstant(instantFromLocal(local, zone), zone)).toBe(local);
  });
});

describe('the two hours that do not behave', () => {
  it('knows 02:30 does not exist on a spring-forward morning', () => {
    // The clock goes 01:59 → 03:00. A merchant who picks this needs telling,
    // not silently rescheduling.
    expect(localTimeExists('2026-03-08T02:30', NY)).toBe(false);
  });

  it('knows an ordinary time does exist', () => {
    expect(localTimeExists('2026-03-08T09:00', NY)).toBe(true);
    expect(localTimeExists('2026-07-15T02:30', NY)).toBe(true);
  });

  it('knows 01:30 happens twice on a fall-back morning', () => {
    expect(localTimeIsAmbiguous('2026-11-01T01:30', NY)).toBe(true);
  });

  it('takes the earlier of the two', () => {
    // "End the sale at 1:30am" means the first 1:30am.
    expect(instantFromLocal('2026-11-01T01:30', NY).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('knows an ordinary time is not ambiguous', () => {
    expect(localTimeIsAmbiguous('2026-11-01T09:00', NY)).toBe(false);
  });
});
