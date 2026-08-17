import { localFromInstant, zoneOffsetMs } from '@pricelogic/shared';

/**
 * Time zones for the schedule picker.
 *
 * **No `moment-timezone`.** The zone database ships with the browser, and
 * `packages/shared/src/scheduling/timezone.ts` already does the conversion
 * with `Intl` — correctly across DST, which the usual `toLocaleString`
 * round-trip is not. Adding a date library here would mean a second zone
 * database to keep updated every time a government moves a DST date, and
 * ~200KB in the bundle to do what the runtime already does.
 */

export interface TimezoneOption {
  /** IANA id, e.g. `America/New_York`. What we store. */
  value: string;
  /** e.g. `America/New_York (GMT-04:00)`. What the merchant reads. */
  label: string;
}

/** The browser's own zone — the sensible default for a new campaign. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** `-04:00` for a zone at a given moment, DST included. */
export function offsetLabel(timeZone: string, at: Date = new Date()): string {
  const minutes = Math.round(zoneOffsetMs(at, timeZone) / 60_000);
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const rest = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${rest}`;
}

/**
 * Every zone the runtime knows, labelled with its current offset.
 *
 * `supportedValuesOf` is not in every engine we might meet, so a short list of
 * common zones is the fallback. It is deliberately short: a merchant whose zone
 * is missing can still be served, because the shop's own zone is always added
 * by `timezoneOptions`.
 */
function allZones(): string[] {
  const supported = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf;

  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      // Fall through to the short list.
    }
  }

  return [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Africa/Cairo',
    'Africa/Lagos',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Dhaka',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

/**
 * Options for a `<Select>`, with the given zone guaranteed present.
 *
 * The guarantee matters: a shop's zone that the browser does not list would
 * otherwise render as an empty select, and saving would silently rewrite the
 * merchant's zone to whatever happened to be first.
 */
export function timezoneOptions(
  ensure?: string,
  at: Date = new Date(),
): TimezoneOption[] {
  const zones = new Set(allZones());
  if (ensure) zones.add(ensure);

  return [...zones]
    .map((zone) => ({
      value: zone,
      label: `${zone.replace(/_/g, ' ')} (GMT${offsetLabel(zone, at)})`,
      offset: zoneOffsetMs(at, zone),
    }))
    .sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value))
    .map(({ value, label }) => ({ value, label }));
}

/** "now", as the `datetime-local` string a merchant in `timeZone` would read. */
export function nowInZone(timeZone: string): string {
  return localFromInstant(new Date(), timeZone);
}

/**
 * A wall-clock time rendered for display, e.g. `16 Aug 2026, 09:00`.
 *
 * Used to show what a stored instant means *in the campaign's own zone*, which
 * is rarely the zone the browser is in.
 */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}
