import type { ReactNode } from "react";

interface BrandedCaseCaptionProps {
  caption: string;
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

export function BrandedCaseCaption({ caption }: BrandedCaseCaptionProps): ReactNode {
  const cleaned = cleanCaseCaption(caption);
  const parties = splitAdversarialCaseCaption(cleaned);
  if (!parties) return cleaned;

  return (
    <>
      {parties[0]}{" "}
      <span className="caseCaptionVersus" aria-label="versus">
        v<span aria-hidden="true">.</span>
      </span>{" "}
      {parties[1]}
    </>
  );
}
