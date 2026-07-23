export function scotusTermLabel(filedOn: string | null): string | null {
  if (!filedOn) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(filedOn);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return `${month >= 10 ? year : year - 1} Term`;
}
