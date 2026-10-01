// Full reporter citations only. Short forms (Id., supra, pin cites) are never
// treated as case identities. Extend the explicit reporter list with fixtures.
const reporter = String.raw`(?:U\.?\s*S\.?|S\.?\s*Ct\.?|L\.?\s*Ed\.?(?:\s*2d)?|F\.?(?:\s*(?:2d|3d|4th))?|F\.?\s*Supp\.?(?:\s*(?:2d|3d))?|F\.?\s*App(?:['’]x|x)\.?|A\.?(?:\s*(?:2d|3d))?|P\.?(?:\s*(?:2d|3d))?|N\.?\s*E\.?(?:\s*(?:2d|3d))?|N\.?\s*W\.?(?:\s*2d)?|S\.?\s*E\.?(?:\s*2d)?|S\.?\s*W\.?(?:\s*(?:2d|3d))?|So\.?(?:\s*(?:2d|3d))?)`;
export const CITATION_PARSER_VERSION = "reporter-citations-v1";
export interface CaseCitation { label: string; key: string; start: number; end: number }
export function citationKey(value: string): string {
  return value.toLowerCase().replace(/[\s.]/g, "").replace(/[’']/g, "'");
}
export function extractCaseCitations(text: string): CaseCitation[] {
  const pattern = new RegExp(String.raw`\b([1-9]\d{0,3})\s+(${reporter})\s+([1-9]\d{0,6})(?!\d)\b`, "g");
  return [...text.matchAll(pattern)].map(match => ({
    label: match[0], key: citationKey(match[0]), start: match.index,
    end: match.index + match[0].length,
  }));
}
export function identityCitations(value: unknown): string[] {
  const labels = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      // A case's metadata must consist of a citation, not arbitrary prose.
      const match = extractCaseCitations(item.trim())[0];
      if (match && match.label === item.trim()) labels.add(match.label);
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
