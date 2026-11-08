/**
 * October Term year. The Court starts a term in October, so November 2026 is
 * the 2026 term and September 2026 is still the 2025 term. Slip-opinion and
 * orders indexes use the two-digit form of this year.
 */
export function currentOctoberTerm(now: Date): { year: number; yy: string; label: string } {
  const year = now.getUTCFullYear();
  const termYear = now.getUTCMonth() >= 9 ? year : year - 1;
  return { year: termYear, yy: String(termYear % 100).padStart(2, "0"), label: `October Term ${termYear}` };
}

export function scotusTermLabel(filedOn: string | null): string | null {
  if (!filedOn) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(filedOn);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return `${month >= 10 ? year : year - 1} Term`;
}
