const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

export function cleanUsaoAttorneyName(value: string): string | null {
  const cleaned = value
    .replace(/\b(?:acting|interim|assistant|special assistant|first assistant|executive assistant)\s+u\.?s\.?\s+attorney\b/gi, " ")
    .replace(/\b(?:united states attorney|ausa|sausa)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 3 || !/[A-Za-z]/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeUsaoAttorneyName(value: string): string | null {
  const cleaned = cleanUsaoAttorneyName(value);
  if (!cleaned) return null;
  const tokens = cleaned.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1] ?? "")) tokens.pop();
  return tokens.length >= 2 ? tokens.join(" ") : null;
}

export function attorneyProfileCompleteness(input: {
  title?: string | null; division?: string | null; biography?: string | null;
  officialProfileUrl?: string | null; photoUrl?: string | null;
}): number {
  return (input.title ? 20 : 0) + (input.division ? 15 : 0) +
    (input.biography ? 30 : 0) + (input.officialProfileUrl ? 20 : 0) +
    (input.photoUrl ? 15 : 0);
}
