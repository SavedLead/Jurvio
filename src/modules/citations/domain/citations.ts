import database from "../data/reporters.json";
// Bounded candidate scanning + a constant-time reporter lookup avoids compiling
// a multi-thousand-branch regex for every rendered paragraph. Overlapping scans
// ensure an unrelated earlier number cannot hide a real citation inside it.
const reporters: Readonly<Record<string, string | null>> = database.reporters;
const fullPattern = /(?=(\b([1-9]\d{0,3})\s+([A-Za-z][A-Za-z\d.\s'’&()/\-]{0,79}?)\s+([1-9]\d{0,9})(?!\d)\b))/g;
const nominativePattern = /\b([1-9]\d{0,3})\s+U\.?\s*S\.?\s*\(\s*\d+\s+(?:Cranch|Wheat\.?|Pet\.?|How\.?|Black|Wall\.?|Dall\.?)\s*\)\s*([1-9]\d{0,6})\b/g;
export const CITATION_PARSER_VERSION = "reporter-citations-v2-flp-3.2.66";
export interface CaseCitation { label: string; key: string; start: number; end: number; ambiguous?: boolean }
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s.]/g, "").replace(/[’']/g, "'");
}
export function citationKey(value: string): string {
  const nominative = new RegExp(`^(?:${nominativePattern.source})$`).exec(value.trim());
  if (nominative) return `${nominative[1]}us${nominative[2]}`;
  const parts = /^([1-9]\d*)\s+(.+?)\s+([1-9]\d*)$/.exec(value.trim());
  if (!parts) return normalize(value);
  const reporter = normalize(parts[2]!);
  return `${parts[1]}${reporters[reporter] ?? reporter}${parts[3]}`;
}
export function extractCaseCitations(text: string): CaseCitation[] {
  const nominative = [...text.matchAll(new RegExp(nominativePattern.source, "g"))].map(match => ({
    label: match[0], key: `${match[1]}us${match[2]}`, start: match.index,
    end: match.index + match[0].length,
  }));
  const full: CaseCitation[] = [];
  for (const match of text.matchAll(new RegExp(fullPattern.source, "g"))) {
    const reporter = normalize(match[3]!);
    if (!Object.hasOwn(reporters, reporter)) continue;
    if (nominative.some(cite => match.index >= cite.start && match.index < cite.end)) continue;
    full.push({label: match[1]!, key: citationKey(match[1]!), start: match.index,
      end: match.index + match[1]!.length, ...(reporters[reporter] === null ? {ambiguous: true} : {})});
  }
  const ordered = [...nominative, ...full].sort((a, b) => a.start - b.start);
  let end = -1;
  return ordered.filter(cite => {
    if (cite.start < end) return false;
    end = cite.end;
    return true;
  });
}
export function identityCitations(value: unknown): string[] {
  const labels = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      // A case's metadata must consist of a citation, not arbitrary prose.
      const match = extractCaseCitations(item.trim())[0];
      if (match && !match.ambiguous && match.label === item.trim()) labels.add(match.label);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.volume && record.reporter && record.page) visit(`${record.volume} ${record.reporter} ${record.page}`);
      for (const name of ["citation", "cite", "label"]) visit(record[name]);
    }
  };
  visit(value);
  return [...labels];
}

export function extractCourtListenerLinks(html: string): CaseCitation[] {
  const pattern=/<a\b[^>]*href=["']https:\/\/www\.courtlistener\.com\/opinion\/(\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  return [...html.matchAll(pattern)].map(match=>({
    key:`cl-cluster:${match[1]}`,label:match[2]!.replace(/<[^>]*>/g,'').trim(),start:match.index,end:match.index+match[0].length,
  })).filter(cite=>cite.label.length>0);
}
