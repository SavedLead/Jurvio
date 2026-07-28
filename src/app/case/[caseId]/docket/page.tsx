import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

export default async function DocketPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const sql = db();
  const legalCase = await getPublicCase(sql, caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocketEntries(sql, caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: `/case/${caseId}/docket`,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn} />
      {records.length > 0 ? (
        <section className="contentSection">
          <p className="sectionKicker">Official activity</p>
          <h2>Full docket</h2>
          <ol className="recordList">
            {records.map((entry) => (
              <li key={entry.publicId}>
                <strong>{entry.entryNumber ? "Entry " + entry.entryNumber : "Docket entry"}</strong>
                {entry.filedOn ? " · " + entry.filedOn : ""}
                <p>{entry.description}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
