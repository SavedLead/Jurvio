/**
 * Eastern-time display helpers.
 *
 * Every Jurvio dashboard, report, and user-facing timestamp renders in
 * America/New_York, which automatically shows EST or EDT depending on the date
 * (the IANA zone carries the daylight-saving rules, so the abbreviation switches
 * on its own — we never hardcode EST/EDT). Formatting is pinned to the zone
 * explicitly so output is identical regardless of the host/container clock.
 *
 * These helpers are for INSTANTS (a moment in time: an ingest time, a heartbeat,
 * a publication update). Calendar dates that carry no time and no zone — a court
 * decision's `filed_on`, a SCOTUS decision date stored as `YYYY-MM-DD` — must NOT
 * be run through here: converting a midnight-UTC calendar date into Eastern would
 * shift it back a day. Format those as plain calendar dates instead.
 */

export const EASTERN_TIME_ZONE = "America/New_York";

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Full instant: date + time + zone abbreviation, e.g. "Aug 10, 2026, 7:28 PM EDT".
 * Use for operational dashboards, reports, and any timestamp where the precise
 * moment matters. `fallback` is returned for null/invalid input.
 */
export function formatEasternDateTime(value: DateInput, fallback = "Not available"): string {
  const date = toDate(value);
  if (!date) return fallback;
  // Explicit component options (not dateStyle/timeStyle, which cannot be
  // combined with timeZoneName) so the EST/EDT abbreviation is included.
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

/**
 * Time only + zone abbreviation, e.g. "7:28 PM EDT".
 */
export function formatEasternTime(value: DateInput, fallback = "Not available"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

/**
 * Eastern calendar date, e.g. "Aug 10, 2026" — the wall-calendar day in Eastern
 * time for an instant. Use where a precise clock time would be noise (public
 * "recently updated" dates) but the day should still reflect Eastern time.
 */
export function formatEasternDate(value: DateInput, fallback = "Not available"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: EASTERN_TIME_ZONE,
  }).format(date);
}

/** The zone abbreviation ("EST" or "EDT") in effect for the given instant. */
export function easternTimeZoneAbbrev(value: DateInput = new Date()): string {
  const date = toDate(value) ?? new Date();
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "ET";
}
