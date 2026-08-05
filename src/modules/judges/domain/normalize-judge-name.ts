const removablePrefixes = /^(?:hon(?:orable)?\.?|chief\s+judge|judge|justice)\s+/i;
const removableSuffixes = /(?:,?\s+(?:u\.s\.\s+)?(?:district|circuit|magistrate|bankruptcy|chief|associate)?\s*(?:judge|justice))\.?$/i;

export function cleanJudgeDisplayName(value: string): string | null {
  let name = value.replace(/\s+/g, " ").trim();
  if (!name || /^(?:unknown|per\s+curiam|court)$/i.test(name)) return null;
  name = name.replace(removablePrefixes, "").replace(removableSuffixes, "").trim();
  if (!name || name.length < 4 || name.length > 160) return null;
  if (!/[a-z]/i.test(name) || /[<>\[\]{}]/.test(name)) return null;
  return name;
}

export function normalizeJudgeName(value: string): string | null {
  const display = cleanJudgeDisplayName(value);
  if (!display) return null;
  const normalized = display
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.split(" ").length >= 2 ? normalized : null;
}
