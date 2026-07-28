import { legalExplainers, type LegalExplainer } from "@/modules/explainers/domain/explainers";

export interface LegalTermContext {
  slug: string;
  term: string;
  aliases: readonly string[];
  definition: string;
  reviewedOn: string;
}

export interface CitedCaseContext {
  citation: string;
  href: string;
  caseName?: string;
  court?: string;
  filedOn?: string;
  relevance?: string;
  sourceHref?: string;
}

const inlineExplainerSlugs = new Set([
  "dismissal-with-or-without-prejudice",
  "jurisdiction",
  "summary-judgment",
  "remand",
  "injunction-and-tro",
  "standing",
  "venue",
  "appeal",
  "per-curiam",
  "writ-of-certiorari",
  "petitioner-and-respondent",
  "affirmed",
  "reversed",
  "vacated",
]);

export const inlineLegalTerms: readonly LegalTermContext[] = legalExplainers
  .filter((explainer) => inlineExplainerSlugs.has(explainer.slug))
  .map(toTermContext);

function toTermContext(explainer: LegalExplainer): LegalTermContext {
  return {
    slug: explainer.slug,
    term: explainer.term,
    aliases: explainer.aliases,
    definition: explainer.oneLine,
    reviewedOn: explainer.reviewedOn,
  };
}

export function hasSourceBackedCaseContext(context: CitedCaseContext): boolean {
  return Boolean(context.relevance?.trim() && context.sourceHref?.trim());
}

export function extractCitationLabels(value: unknown): string[] {
  const labels = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      const label = candidate.trim();
      if (label.length >= 3 && label.length <= 180) labels.add(label);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      for (const key of ["citation", "cite", "label"]) {
        if (typeof record[key] === "string") visit(record[key]);
      }
    }
  };
  visit(value);
  return [...labels];
}


export function distinguishReportersNote(html: string): string {
  const marker = "<p>Reporter’s Note</p>";
  const markerWithoutApostrophe = "<p>Reporters Note</p>";
  const matchedMarker = html.includes(marker) ? marker : html.includes(markerWithoutApostrophe) ? markerWithoutApostrophe : null;
  if (!matchedMarker) return html;

  const markerIndex = html.indexOf(matchedMarker);
  const opinion = html.slice(0, markerIndex);
  const note = html.slice(markerIndex + matchedMarker.length);
  return `${opinion}<aside class="reportersNote" aria-labelledby="reporters-note-heading"><h2 id="reporters-note-heading">Reporter’s Note</h2><p class="reportersNoteExplanation">Publication corrections from the Reporter of Decisions. This note is not part of the Court’s opinion.</p>${note}</aside>`;
}
