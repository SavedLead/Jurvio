import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { loadRequestPublicCase } from "@/app/case/load-public-case";
import { listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

interface SectionPageProps { params: Promise<{ caseId: string }> }

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { caseId } = await params;
  const legalCase = await loadRequestPublicCase(caseId);
  if (!legalCase) return { title: "Parties not found" };
  const caption = cleanCaseCaption(legalCase.caption);
  return {
    title: [caption, "Parties", legalCase.docketNumber, legalCase.courtName].filter(Boolean).join(" | "),
    description: `Verified parties currently available for ${caption}, docket ${legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${caseId}/parties` },
  };
}

export default async function PartiesPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const sql = db();
  const legalCase = await loadRequestPublicCase(caseId);
  if (!legalCase) notFound();
  const records = await listPublicParties(sql, caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/parties`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn}
        decidedOn={legalCase.decidedOn} courtCode={legalCase.courtCode} />
      {records.length > 0 ? (
        <section className="contentSection">
          <p className="sectionKicker">Named in the court record</p>
          <h2>Parties</h2>
          <p className="sourceNote">Being named in a case does not establish liability, wrongdoing, or guilt.</p>
          <ul className="recordList">
            {records.map((party) => (
              <li key={party.publicId + ":" + party.role}>
                <strong>{party.displayName}</strong>
                <p>{party.role.replaceAll("_", " ")} · Name as filed: {party.nameAsFiled}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
