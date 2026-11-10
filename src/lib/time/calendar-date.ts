/**
 * Calendar dates a court recorded, and clock times visitors see.
 *
 * A filed date, an entry date, and a decided date are calendar days. Formatting
 * them with the server zone or the browser zone moves the day when the value
 * sits on a UTC midnight boundary, and the two renders then disagree.
 * Date-only values are formatted from their year, month, and day.
 *
 * A timestamp is an instant. Its calendar day is computed in an explicit zone:
 * the court's zone for a filing, America/New_York when the caller has no court
 * zone. Displayed clock times use America/New_York and are labeled ET.
 */

export const COURT_DATE_FALLBACK_ZONE = "America/New_York";

const MONTHS = ["Jan.", "Feb.", "Mar", "Apr", "May", "Jun", "Jul", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."] as const;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function formatParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const name = MONTHS[month - 1];
  return name ? `${name} ${day}, ${year}` : null;
}

function partsInZone(instant: Date, timeZone: string): { year: number; month: number; day: number } | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function zonedInstant(value: string): Date | null {
  const match = STAMP.exec(value.trim());
  if (!match?.[7]) return null;
  const normalized = value.trim().includes(" ") ? value.trim().replace(" ", "T") : value.trim();
  const instant = new Date(normalized);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** YYYY-MM-DD for an instant in an IANA zone. */
export function calendarDateInZone(value: string, timeZone: string): string | null {
  const instant = zonedInstant(value);
  if (!instant) return null;
  try {
    const parts = partsInZone(instant, timeZone);
    if (!parts) return null;
    const month = String(parts.month).padStart(2, "0");
    const day = String(parts.day).padStart(2, "0");
    return `${parts.year}-${month}-${day}`;
  } catch {
    return null;
  }
}

export function utcCalendarDate(value: string): string | null {
  return calendarDateInZone(value, "UTC");
}

/**
 * Public calendar date. A YYYY-MM-DD value stays on that day in every zone.
 * A timestamp is converted in `timeZone`.
 */
export function formatCalendarDate(value: string | null | undefined, timeZone = COURT_DATE_FALLBACK_ZONE): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) return formatParts(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  const match = STAMP.exec(trimmed);
  if (!match) return null;
  if (!match[7]) return formatParts(Number(match[1]), Number(match[2]), Number(match[3]));
  const instant = zonedInstant(trimmed);
  if (!instant) return null;
  try {
    const parts = partsInZone(instant, timeZone);
    return parts ? formatParts(parts.year, parts.month, parts.day) : null;
  } catch {
    return null;
  }
}

/** Today's calendar day in Eastern time, as YYYY-MM-DD. */
export function easternCalendarToday(now = new Date()): string {
  const parts = partsInZone(now, COURT_DATE_FALLBACK_ZONE);
  if (!parts) return "1970-01-01";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** A YYYY-MM-DD on or before today. A later day is not a filed or latest date. */
export function dateOnOrBeforeToday(value: string | null | undefined, today = easternCalendarToday()): string | null {
  if (!value) return null;
  const day = value.trim().slice(0, 10);
  if (!DATE_ONLY.test(day)) return null;
  return day > today ? null : day;
}

/** Clock time in Eastern time, labeled ET so server and browser render the same text. */
export function formatEasternClock(value: string | Date | null | undefined, fallback = ""): string {
  if (value == null || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: COURT_DATE_FALLBACK_ZONE,
  }).format(date);
  return `${clock} ET`;
}
