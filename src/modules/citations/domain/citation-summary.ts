import { citationKey, extractCaseCitations, extractCourtListenerLinks } from "./citations";

/**
 * Reader-facing citation counts for one opinion.
 *
 * A "cited case" is one distinct reporter citation found in the court's text.
 * Repeated mentions of the same case count once in `cases` and once each in
 * `mentions`. Ambiguous reporter abbreviations are never counted, matching the
 * linker, so the counter can never claim a citation the page refuses to link.
 * The opinion's own citation (its header usually repeats it) is excluded.
 */
export interface CitationSummary {
  mentions: number;
  cases: number;
  onJurvio: number;
  notYetOnJurvio: Array<{ key: string; label: string }>;
}

export function summarizeCitations(
  text: string,
  html: string,
  linkedKeys: ReadonlySet<string>,
  ownCitations: readonly (string | null | undefined)[] = [],
): CitationSummary {
  const own = new Set(ownCitations.filter((value): value is string => Boolean(value)).map(citationKey));
  // CourtListener wraps many citations in its own cluster links. When that
  // cluster is linked on Jurvio, the reporter citation inside it is linked too.
  const clusterFor = new Map<string, string>();
  for (const anchor of extractCourtListenerLinks(html)) {
    for (const cite of extractCaseCitations(anchor.label)) {
      if (!cite.ambiguous && !clusterFor.has(cite.key)) clusterFor.set(cite.key, anchor.key);
    }
  }
  const labels = new Map<string, string>();
  let mentions = 0;
  for (const cite of extractCaseCitations(text)) {
    if (cite.ambiguous || own.has(cite.key)) continue;
    mentions++;
    if (!labels.has(cite.key)) labels.set(cite.key, cite.label);
  }
  const notYetOnJurvio: CitationSummary["notYetOnJurvio"] = [];
  let onJurvio = 0;
  for (const [key, label] of labels) {
    const cluster = clusterFor.get(key);
    if (linkedKeys.has(key) || (cluster !== undefined && linkedKeys.has(cluster))) onJurvio++;
    else notYetOnJurvio.push({ key, label: label.replace(/\s+/g, " ") });
  }
  return { mentions, cases: labels.size, onJurvio, notYetOnJurvio };
}

/** "Cites 42 cases · 31 on Jurvio" — plain language, no jargon. */
export function citationCountLine(cases: number, onJurvio: number): string {
  if (cases === 0) return "No case citations found";
  const noun = cases === 1 ? "case" : "cases";
  if (onJurvio === cases) return `Cites ${cases} ${noun} · all on Jurvio`;
  return `Cites ${cases} ${noun} · ${onJurvio} on Jurvio`;
}
