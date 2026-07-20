import type { Route } from "next";
import Link from "next/link";

const sections = [
  ["Overview", ""],
  ["Docket", "/docket"],
  ["Parties", "/parties"],
  ["Documents", "/documents"],
  ["Timeline", "/timeline"],
] as const;

export function CaseNav({ caseId }: { caseId: string }) {
  return (
    <nav aria-label="Case sections" className="caseNav">
      {sections.map(([label, suffix]) => (
        <Link key={label} href={("/case/" + caseId + suffix) as Route}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
