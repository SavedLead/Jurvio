import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import type { Route } from "next";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import {
  listPublicDocketEntries,
  listPublicDocuments,
  listPublicParties,
} from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

function humanize(value: string | null) {
  if (!value || value === "unknown" || value === "not_applicable") return null;
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function CasePage({ params }: CasePageProps) {
  const { caseId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId)) notFound();

  const sql = db();
  const legalCase = await getPublicCase(sql, caseId);
  if (!legalCase) notFound();
  const [docketEntries, parties, documents] = await Promise.all([
    listPublicDocketEntries(sql, caseId),
    listPublicParties(sql, caseId),
    listPublicDocuments(sql, caseId),
  ]);
  const verified = legalCase.verification === "verified";
  const statusDetails = [
    ["Activity", humanize(legalCase.activityState)],
    ["Phase", humanize(legalCase.proceduralPhase)],
    ["Disposition", humanize(legalCase.dispositionScope)],
    ["Judgment", humanize(legalCase.judgmentState)],
    ["Appeal", humanize(legalCase.appealState)],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: `/case/${caseId}`,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  const sectionCards = [
    { label: "Docket entries", count: docketEntries.length, suffix: "/docket" },
    { label: "Parties", count: parties.length, suffix: "/parties" },
    { label: "Documents", count: documents.length, suffix: "/documents" },
    { label: "Timeline events", count: docketEntries.length, suffix: "/timeline" },
  ] as const;

  return (
    <main className="shell caseShell">
      <CaseHeader
        caseId={caseId}
        caption={legalCase.caption}
        courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber}
        filedOn={legalCase.filedOn}
      />

      <section className="caseOverview" aria-labelledby="case-overview">
        <p className="sectionKicker">Case overview</p>
        <h2 id="case-overview">At a glance</h2>
        <div className="caseSectionGrid">
          {sectionCards.map((section) => (
            <Link
              key={section.label}
              className="caseSectionCard"
              href={(`/case/${caseId}${section.suffix}`) as Route}
            >
              <strong>{section.count.toLocaleString()}</strong>
              <span>{section.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {verified && (legalCase.statusExplanation || statusDetails.length > 0) ? (
        <section className="contentSection" aria-labelledby="current-status">
          <p className="sectionKicker">Current posture</p>
          <h2 id="current-status">Case status</h2>
          {legalCase.statusExplanation ? <p className="statusExplanation">{legalCase.statusExplanation}</p> : null}
          {statusDetails.length > 0 ? (
            <dl className="caseStatusGrid">
              {statusDetails.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}

      {docketEntries.length > 0 ? (
        <section className="contentSection" aria-labelledby="recent-activity">
          <p className="sectionKicker">Official activity</p>
          <h2 id="recent-activity">Recent docket activity</h2>
          <ol className="recordList">
            {docketEntries.slice(0, 5).map((entry) => (
              <li key={entry.publicId}>
                <strong>{entry.entryNumber ? `Entry ${entry.entryNumber}` : "Docket entry"}</strong>
                {entry.filedOn ? ` · ${entry.filedOn}` : ""}
                <p>{entry.description}</p>
              </li>
            ))}
          </ol>
          <Link className="sectionLink" href={(`/case/${caseId}/docket`) as Route}>View full docket →</Link>
        </section>
      ) : null}

      {parties.length > 0 ? (
        <section className="contentSection" aria-labelledby="named-parties">
          <p className="sectionKicker">Named in the record</p>
          <h2 id="named-parties">Parties</h2>
          <p className="sourceNote">Being named in a case does not establish liability, wrongdoing, or guilt.</p>
          <ul className="recordList">
            {parties.slice(0, 8).map((party) => (
              <li key={party.publicId + ":" + party.role}>
                <strong>{party.displayName}</strong>
                <p>{humanize(party.role) ?? party.role}</p>
              </li>
            ))}
          </ul>
          <Link className="sectionLink" href={(`/case/${caseId}/parties`) as Route}>View all parties →</Link>
        </section>
      ) : null}

      {documents.length > 0 ? (
        <section className="contentSection" aria-labelledby="case-documents">
          <p className="sectionKicker">Source material</p>
          <h2 id="case-documents">Documents</h2>
          <ul className="recordList">
            {documents.slice(0, 5).map((document) => (
              <li key={document.publicId}>
                <strong>{document.title}</strong>
                {document.filedOn ? ` · ${document.filedOn}` : ""}
                <p>{humanize(document.documentType) ?? document.documentType}</p>
              </li>
            ))}
          </ul>
          <Link className="sectionLink" href={(`/case/${caseId}/documents`) as Route}>View all documents →</Link>
        </section>
      ) : null}
    </main>
  );
}
