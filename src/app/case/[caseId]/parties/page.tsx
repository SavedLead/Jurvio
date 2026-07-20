import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { CaseNav } from "@/modules/cases/ui/case-nav";

export const dynamic = "force-dynamic";

export default async function PartiesPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicParties(db(), caseId);

  return (
    <main className="shell">
      <p className="eyebrow">{legalCase.courtName}</p>
      <h1>{legalCase.caption}</h1>
      <CaseNav caseId={caseId} />
      <section>
        <h2>Parties</h2>
        {records.length === 0 ? <p>No parties are approved for publication.</p> : (
          <ul>{records.map((party) => (
            <li key={party.publicId + ":" + party.role}>
              <strong>{party.displayName}</strong> · {party.role}
            </li>
          ))}</ul>
        )}
      </section>
    </main>
  );
}
