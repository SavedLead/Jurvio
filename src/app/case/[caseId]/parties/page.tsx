import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

export default async function PartiesPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicParties(db(), caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(db(), {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: `/case/${caseId}/parties`,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader
        caseId={caseId}
        caption={legalCase.caption}
        courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber}
        filedOn={legalCase.filedOn}
      />
      <section className="contentSection">
        <p className="sectionKicker">Named in the court record</p>
        <h2>Parties</h2>
        <p className="sourceNote">
          Being named in a case does not establish liability, wrongdoing, or guilt.
        </p>
        {records.length === 0 ? (
          <p className="emptyState">No parties are approved for publication.</p>
        ) : (
          <ul className="recordList">
            {records.map((party) => (
              <li key={party.publicId + ":" + party.role}>
                <strong>{party.displayName}</strong>
                <p>{party.role} · Name as filed: {party.nameAsFiled}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
