import type { ReactNode } from "react";
import { highlightSegments } from "@/modules/cases/domain/case-listing";

interface BrandedCaseCaptionProps {
  caption: string;
  /** Optional search text to mark within the party names. The "v." brand mark is never highlighted. */
  highlight?: string | null;
}

const revisionSuffix = /\s+(?:revisions?|revised)\s*:\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i;
const malformedGovernmentCaptionPrefix = /^\d+\s*(?=(?:USA|United States)\s+v\.\s+)/i;

export function cleanCaseCaption(caption: string) {
  let cleaned = caption.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(malformedGovernmentCaptionPrefix, "");
  while (revisionSuffix.test(cleaned)) cleaned = cleaned.replace(revisionSuffix, "").trim();
  return cleaned;
}

export function splitAdversarialCaseCaption(caption: string): [string, string] | null {
  const cleaned = cleanCaseCaption(caption);
  if (/^(?:in re|ex parte)\b/i.test(cleaned)) return null;
  const match = /\s+v\.\s+/i.exec(cleaned);
  if (!match || match.index === undefined) return null;
  return [
    cleaned.slice(0, match.index).trimEnd(),
    cleaned.slice(match.index + match[0].length).trimStart(),
  ];
}

export function HighlightedText({ text, highlight }: { text: string; highlight?: string | null }): ReactNode {
  const segments = highlightSegments(text, highlight);
  if (segments.length === 1 && !segments[0]?.match) return text;
  return segments.map((segment, index) => (
    segment.match ? <mark key={index} className="searchHighlight">{segment.text}</mark> : segment.text
  ));
}

export function BrandedCaseCaption({ caption, highlight }: BrandedCaseCaptionProps): ReactNode {
  const cleaned = cleanCaseCaption(caption);
  const parties = splitAdversarialCaseCaption(cleaned);
  if (!parties) return <HighlightedText text={cleaned} highlight={highlight} />;

  return (
    <>
      <HighlightedText text={parties[0]} highlight={highlight} />{" "}
      <span className="caseCaptionVersus" aria-label="versus">
        v<span aria-hidden="true">.</span>
      </span>{" "}
      <HighlightedText text={parties[1]} highlight={highlight} />
    </>
  );
}
