import type { LegalTerm } from "@/modules/cases/domain/plain-language";
import { LEGAL_TERM_DEFINITIONS } from "@/modules/cases/domain/plain-language";

export function LegalTermHint({
  term,
  children,
}: {
  term: LegalTerm;
  children?: React.ReactNode;
}) {
  return (
    <span className="legalTerm" tabIndex={0}>
      {children ?? term}
      <span className="legalTermDefinition" role="note">
        <strong>{term}</strong>
        {LEGAL_TERM_DEFINITIONS[term]}
      </span>
    </span>
  );
}
