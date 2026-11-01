import type { ReactNode } from "react";
import { segmentTerms, type PlainTerm } from "../domain/term-index";

/**
 * One marker per page section: each dictionary term is underlined only at its
 * first occurrence within the section that owns the marker.
 */
export interface TermMarker {
  id: string;
  seen: Set<string>;
}

export function createTermMarker(id: string): TermMarker {
  return { id: id.replace(/[^a-z0-9-]/gi, "-"), seen: new Set() };
}

/** Plain text with the section's first mention of each dictionary term marked. */
export function TermText({ text, marker }: { text: string | null | undefined; marker: TermMarker }) {
  if (!text) return null;
  const segments = segmentTerms(text, marker.seen);
  if (segments.length === 1 && typeof segments[0] === "string") return <>{text}</>;
  return <>{segments.map((segment, index): ReactNode => typeof segment === "string"
    ? segment
    : <LegalTermTip key={`${index}-${segment.term.key}`} term={segment.term} id={`pt-${marker.id}-${segment.term.key}`}>{segment.text}</LegalTermTip>)}</>;
}

/**
 * Dotted-underlined term with a plain-English card. Hover (desktop), keyboard
 * focus, or tap (PlainTermsBehavior toggles data-open) shows the card. The card
 * is server-rendered so it works without JavaScript and is read by screen
 * readers through aria-describedby; data-nosnippet keeps it out of search snippets.
 */
export function LegalTermTip({ term, id, children }: { term: PlainTerm; id: string; children: ReactNode }) {
  return <span className="ptTerm">
    <button type="button" className="ptTrigger" aria-describedby={id} aria-expanded="false" aria-controls={id}>{children}</button>
    <span className="ptCard" id={id} role="tooltip" data-nosnippet="">
      <strong className="ptCardTerm">{term.term}</strong>
      <span className="ptCardDef">{term.definition}</span>
      <a className="ptCardLink" href={term.href}>Learn more<span className="ptSrOnly"> about {term.term.toLowerCase()}</span> →</a>
    </span>
  </span>;
}
