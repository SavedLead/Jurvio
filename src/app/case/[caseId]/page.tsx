import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { CaseNav } from "@/modules/cases/ui/case-nav";

export const dynamic = "force-dynamic";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

export default async function CasePage({ params }: CasePageProps) {
  const { caseId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId)) notFound();

  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const verified = legalCase.verification === "verified";

  return (
    <main className="shell">
      <nav aria-label="Breadcrumb">Cases / {legalCase.publicId}</nav>
      <article>
        <p className="eyebrow">{legalCase.courtName}</p>
        <h1>{legalCase.caption}</h1>
        <p>Docket {legalCase.docketNumber}</p>
        <CaseNav caseId={caseId} />
        <section aria-labelledby="current-status">
          <h2 id="current-status">Current status</h2>
          <p>
            {verified
              ? legalCase.statusExplanation
              : "The current status has not been verified from a qualifying court event."}
          </p>
          {verified ? (
            <dl>
              <dt>Activity</dt><dd>{legalCase.activityState}</dd>
              <dt>Phase</dt><dd>{legalCase.proceduralPhase}</dd>
              <dt>Disposition</dt><dd>{legalCase.dispositionScope}</dd>
              <dt>Judgment</dt><dd>{legalCase.judgmentState}</dd>
              <dt>Appeal</dt><dd>{legalCase.appealState}</dd>
            </dl>
          ) : null}
        </section>
      </article>
    </main>
  );
}
