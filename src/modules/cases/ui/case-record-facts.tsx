import type { Route } from "next";
import Link from "next/link";
import type { PublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicParties, listStoredFactLines, type PublicParty } from "@/modules/cases/application/list-public-case-sections";
import { db } from "@/db/client";
import { jurisdictionBasisFromText, juryDemandFromText } from "@/modules/cases/domain/docket-classification";
import { docketCaseType, formatCauseOfAction, parseNatureOfSuit } from "@/modules/cases/domain/record-answers";
import { publicPartyRole } from "@/modules/cases/domain/public-labels";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";

const CASE_TYPES: Record<string, string> = {
  cv: "Civil",
  cr: "Criminal",
  mc: "Miscellaneous",
  mj: "Magistrate",
  md: "Multidistrict",
  bk: "Bankruptcy",
  ap: "Adversary",
  po: "Petty offense",
};

const PARTY_PREVIEW = 24;

/**
 * Structured fields already stored on the case. A field with no stored value
 * is omitted. Jury demand and jurisdiction basis are shown only when a stored
 * line or the stored cause states them.
 */
export async function CaseRecordFacts({
  caseId,
  legalCase,
  parties,
}: {
  caseId: string;
  legalCase: PublicCase;
  parties?: PublicParty[];
}) {
  const [loadedParties, factLines] = await Promise.all([
    parties ? Promise.resolve(parties) : listPublicParties(db(), caseId).catch(() => []),
    listStoredFactLines(db(), caseId).catch(() => []),
  ]);
  const nature = parseNatureOfSuit(legalCase.natureOfSuit);
  const cause = formatCauseOfAction(legalCase.causeOfAction);
  const jurisdictionBasis = jurisdictionBasisFromText(legalCase.causeOfAction, factLines);
  const juryDemand = juryDemandFromText(factLines);
  const typeCode = docketCaseType(legalCase.docketNumber);
  const caseType = typeCode ? CASE_TYPES[typeCode] ?? null : null;
  const closed = formatPublicCaseDate(legalCase.terminatedOn);
  const facts: Array<[string, string]> = [];
  if (legalCase.judgeName) facts.push(["Assigned judge", legalCase.judgeName]);
  if (caseType) facts.push(["Case type", caseType]);
  if (cause) facts.push(["Cause", cause]);
  if (jurisdictionBasis) facts.push(["Jurisdiction basis", jurisdictionBasis]);
  if (juryDemand) facts.push(["Jury demand", juryDemand]);
  if (nature) facts.push(["Nature of suit", nature.code ? `${nature.code} ${nature.label}` : nature.label]);
  if (legalCase.courtJurisdiction) facts.push(["Jurisdiction", legalCase.courtJurisdiction]);
  if (closed) facts.push(["Closed", closed]);
  if (facts.length === 0 && loadedParties.length === 0) return null;
  const shownParties = loadedParties.slice(0, PARTY_PREVIEW);
  const moreParties = loadedParties.length - shownParties.length;
  return (
    <section className="contentSection" aria-label="Case record">
      {facts.length > 0 ? (
        <dl className="caseMeta">
          {facts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      ) : null}
      {shownParties.length > 0 ? (
        <ul className="recordList">
          {shownParties.map((party) => (
            <li key={party.publicId}>
              <strong>{publicPartyRole(party.role)}</strong>
              {" · "}
              {party.displayName}
            </li>
          ))}
        </ul>
      ) : null}
      {moreParties > 0 ? (
        <p><Link href={`/case/${caseId}/parties` as Route}>{moreParties.toLocaleString("en-US")} more parties</Link></p>
      ) : null}
    </section>
  );
}
