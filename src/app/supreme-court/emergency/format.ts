import { APPLICATION_KIND_LABEL, type ApplicationKind } from "@/modules/scotus/domain/emergency-application";

export function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

/** ISO timestamp ("2026-11-04T11:13:02.1+00:00") -> "Nov 4, 6:13 AM ET" */
export function easternTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date)} ET`;
}

export function justiceLabel(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return /chief/i.test(ref) ? "the Chief Justice" : `Justice ${ref}`;
}

export function kindLabel(kind: ApplicationKind, capital: boolean): string {
  if (capital && kind !== "stay_of_execution" && kind !== "extension") return `${APPLICATION_KIND_LABEL[kind]} · capital case`;
  return APPLICATION_KIND_LABEL[kind];
}

export function daysUntil(dateIso: string, today: string): number {
  return Math.round((Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
