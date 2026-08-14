/** An ISO-8601 timestamp string, e.g. `2026-08-14T09:30:00.000Z`. */
export type Iso8601 = string;

/**
 * The wire shape of a domain model.
 *
 * Domain models carry `Date` because that is what TypeORM hands the backend.
 * JSON has no date type, so by the time the admin UI sees a record every
 * `Date` has become a string. Rather than hand-maintaining a parallel
 * interface per table — which drifts the first time someone adds a column to
 * only one of them — the wire type is derived:
 *
 * ```ts
 * export type CampaignDto = Serialized<Campaign>;
 * ```
 *
 * Shallow by design: every model in this package is flat, and a deep mapper
 * would recurse into `Record<string, unknown>` payloads such as
 * `CsvRow.rawData` and mangle them.
 */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? Iso8601
    : T[K] extends Date | null
      ? Iso8601 | null
      : T[K];
};
