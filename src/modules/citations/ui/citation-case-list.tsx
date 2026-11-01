import Link from "next/link";
import type { RelatedCitationCase } from "../application/public-citations";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";

/**
 * A linked-case list with an honest total. `total` is the full count of distinct
 * cases (including ones not yet on Jurvio for "Cases cited"); `summary` is the
 * plain-language count line shown under the heading.
 */
export function CitationCaseList({id, title, cases, total, summary}: {
  id?: string;
  title: string;
  cases: readonly RelatedCitationCase[];
  total?: number;
  summary?: string;
}) {
  const count = total ?? cases.length;
  if (!cases.length && !count) return null;
  return <section id={id} className="contentSection caseFeatureSection citationCaseList">
    <div className="featureHeading">
      <h2>{title} <span className="citationCount">{count.toLocaleString("en-US")}</span></h2>
    </div>
    {summary ? <p className="citationSummary">{summary}</p> : null}
    {cases.length ? <ul>{cases.map(record=><li key={record.casePublicId}>
      <Link href={`/case/${record.casePublicId}`}>{cleanCaseCaption(record.caption)}</Link>
      <small> · {record.courtName} · {record.citationLabel}</small>
    </li>)}</ul> : null}
    {cases.length===50 ? <p>Showing 50 linked cases from Jurvio’s published opinions.</p> : null}
  </section>;
}
