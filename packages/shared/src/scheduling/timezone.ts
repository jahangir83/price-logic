/**
 * Wall-clock time in a merchant's zone, converted to an instant.
 *
 * `campaigns.start_at` is an instant; `start_timezone` is the merchant's
 * *intent*. Storing only the instant loses the intent, and storing only the
 * local time loses the answer — a campaign set for "9am" in New York is
 * 13:00Z in summer and 14:00Z in winter, and the merchant means 9am both
 * times. Keeping both is what lets a schedule survive a DST boundary.
 *
 * Implemented with `Intl` rather than a date library: the zone database ships
 * with the runtime, and a dependency here would need updating every time a
 * government moves a DST date.
 */

/** How far ahead of UTC a zone is at a given instant, in milliseconds. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // Read the local wall clock, then re-read it as though it were UTC. The
  // difference between that and the real instant is the offset.
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return asIfUtc - instant.getTime();
}

/**
 * `"2026-03-08T09:00"` in `America/New_York` → the instant it happens.
 *
 * Two passes, because the offset depends on the instant we are solving for.
 * The first pass guesses using the offset at the naive timestamp; the second
 * corrects it using the offset at the guessed instant. That converges for
 * every real zone — offsets change by at most a couple of hours, never enough
 * for a third pass to move the answer.
 */
export function instantFromLocal(local: string, timeZone: string): Date {
  const naive = Date.parse(`${normaliseLocal(local)}Z`);
  if (Number.isNaN(naive)) {
    throw new RangeError(`Not a local date-time: ${local}`);
  }

  let instant = naive - zoneOffsetMs(new Date(naive), timeZone);
  instant = naive - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** The wall-clock time an instant shows in a zone, as `YYYY-MM-DDTHH:mm`. */
export function localFromInstant(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Does this local time actually exist in this zone?
 *
 * On a spring-forward morning the clock jumps from 01:59 to 03:00, so 02:30
 * never happens. `instantFromLocal` still returns *an* instant for it —
 * whatever the arithmetic lands on — which is fine for a scheduler but wrong
 * to show a merchant without saying so.
 */
export function localTimeExists(local: string, timeZone: string): boolean {
  const instant = instantFromLocal(local, timeZone);
  return localFromInstant(instant, timeZone) === normaliseLocal(local).slice(0, 16);
}

/**
 * Does this local time happen twice?
 *
 * On a fall-back morning 01:30 occurs once in daylight time and again an hour
 * later in standard time. We take the first — the earlier instant — because a
 * merchant who says "end the sale at 1:30am" means the first 1:30am.
 */
export function localTimeIsAmbiguous(local: string, timeZone: string): boolean {
  const instant = instantFromLocal(local, timeZone);
  const hourLater = new Date(instant.getTime() + 3_600_000);
  return (
    localFromInstant(instant, timeZone) ===
    localFromInstant(hourLater, timeZone)
  );
}

/** Accepts `YYYY-MM-DD HH:mm` as well as the `T` form, with or without seconds. */
function normaliseLocal(local: string): string {
  const trimmed = local.trim().replace(' ', 'T');
  return trimmed.length === 16 ? `${trimmed}:00` : trimmed;
}
