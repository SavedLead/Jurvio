const hiddenStatusValues = new Set(["", "active", "filing", "none", "unknown", "unavailable", "not_applicable"]);

export function humanizeVerifiedValue(value: string | null | undefined) {
  if (!value || hiddenStatusValues.has(value.toLowerCase())) return null;
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function visibleCaseStatusDetails(input: {
  dispositionScope: string;
  judgmentState: string;
  appealState: string;
}) {
  return [
    ["Disposition", humanizeVerifiedValue(input.dispositionScope)],
    ["Judgment", humanizeVerifiedValue(input.judgmentState)],
    ["Appeal", humanizeVerifiedValue(input.appealState)],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));
}

export function extractOfficialCitation(text: string) {
  const match = /(?:Cite as:\s*)?(\d{1,4}\s+U\.\s*S\.\s+\d{1,5}\s*\(\d{4}\))/i.exec(text);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}


export function formatVerifiedOutcome(value: string | null | undefined) {
  const humanized = humanizeVerifiedValue(value);
  if (!humanized) return null;
  return humanized
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\b(And|Or|To|Of|The)\b/g, (word) => word.toLowerCase());
}

export function formatPublicCaseDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  const abbreviatedMonth = ["Mar", "Apr", "May", "Jun", "Jul"].includes(month) ? month : `${month}.`;
  return `${abbreviatedMonth} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
