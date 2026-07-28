import type { Route } from "next";
import Link from "next/link";

const sections = [
  ["Summary", ""],
  ["Docket", "/docket"],
  ["Filings & documents", "/documents"],
  ["Parties", "/parties"],
  ["Attorneys", "/attorneys"],
  ["Timeline", "/timeline"],
  ["Judgments & opinions", "/opinions"],
] as const;

export type CaseSection = typeof sections[number][1];

export function CaseNav({ caseId, active }: { caseId: string; active?: CaseSection }) {
  return (
    <nav aria-label="Case sections" className="caseNav">
      {sections.map(([label, suffix]) => (
        <Link key={label} href={("/case/" + caseId + suffix) as Route}
          aria-current={active === suffix ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
