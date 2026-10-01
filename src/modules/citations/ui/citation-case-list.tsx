import Link from "next/link";
import type { RelatedCitationCase } from "../application/public-citations";
export function CitationCaseList({title, cases}: {title: string; cases: readonly RelatedCitationCase[]}) {
  if (!cases.length) return null;
  return <section className="contentSection caseFeatureSection"><h2>{title}</h2>
    <ul>{cases.map(record=><li key={record.casePublicId}>
      <Link href={`/case/${record.casePublicId}`}>{record.caption}</Link>
      <small> · {record.courtName} · {record.citationLabel}</small>
    </li>)}</ul>
    {cases.length===50 ? <p>Showing up to 50 linked cases from Jurvio’s published opinions.</p> : null}
  </section>;
}
