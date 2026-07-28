import type { ReactNode } from "react";

interface BrandedCaseCaptionProps {
  caption: string;
}

export function splitAdversarialCaseCaption(caption: string): [string, string] | null {
  const match = /\s+v\.\s+/i.exec(caption);
  if (!match || match.index === undefined) return null;
  return [
    caption.slice(0, match.index).trimEnd(),
    caption.slice(match.index + match[0].length).trimStart(),
  ];
}

export function BrandedCaseCaption({ caption }: BrandedCaseCaptionProps): ReactNode {
  const parties = splitAdversarialCaseCaption(caption);
  if (!parties) return caption;

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
