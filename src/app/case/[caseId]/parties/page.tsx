import type { Metadata } from "next";
import { robotsFor } from "@/lib/seo/indexing";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { loadCaseForViewer } from "@/app/case/load-public-case";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import { listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { createTermMarker, TermText } from "@/modules/plain-english/ui/term-text";

export const dynamic = "force-dynamic";

interface SectionPageProps { params: Promise<{ caseId: string }> }

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") return { title: "Parties not found" };
  if (access.status === "gated") return subscriberGateMetadata();
  const legalCase = access.legalCase;
  const caption = cleanCaseCaption(legalCase.caption);
  return {
    title: [caption, "Parties", legalCase.docketNumber, legalCase.courtName].filter(Boolean).join(" | "),
    description: `Verified parties currently available for ${caption}, docket ${legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${caseId}/parties` },
    robots: robotsFor(!legalCase.searchExcluded),
  };
}

export default async function PartiesPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const sql = db();
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") notFound();
  if (access.status === "gated") return <SubscriberCaseGate path={`/case/${caseId}/parties`} />;
  const legalCase = access.legalCase;
  const records = await listPublicParties(sql, caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/parties`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  const partiesMarker = createTermMarker("parties");
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
                <p><TermText text={party.role.replaceAll("_", " ")} marker={partiesMarker} /> · Name as filed: {party.nameAsFiled}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
