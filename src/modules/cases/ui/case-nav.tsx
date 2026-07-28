import type { Route } from "next";
import Link from "next/link";

export const caseSections = [
  ["Overview", ""],
  ["Docket", "/docket"],
  ["Parties", "/parties"],
  ["Documents", "/documents"],
  ["Timeline", "/timeline"],
] as const;

function SectionLinks({ caseId }: { caseId: string }) {
  return caseSections.map(([label, suffix]) => (
    <Link key={label} href={("/case/" + caseId + suffix) as Route}>
      {label}
    </Link>
  ));
}

export function CaseNav({ caseId }: { caseId: string }) {
  return (
    <>
      <nav aria-label="Case sections" className="caseNav caseNavDesktop">
        <SectionLinks caseId={caseId} />
      </nav>
      <details className="caseNavMobile">
        <summary>Case sections</summary>
        <nav aria-label="Case sections">
          <SectionLinks caseId={caseId} />
        </nav>
      </details>
    </>
  );
}
