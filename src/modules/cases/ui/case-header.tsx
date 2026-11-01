import { CaseNav } from "./case-nav";
import { BrandedCaseCaption } from "./branded-case-caption";
import { caseCitationSuffix } from "@/modules/cases/domain/case-title";

interface CaseHeaderProps {
  caseId: string;
  caption: string;
  courtName: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn?: string | null;
  supremeCourtTerm?: number | null;
  officialCitation?: string | null;
  courtCode?: string | null;
  showNavigation?: boolean;
}

export function CaseHeader({
  caseId,
  caption,
  courtName,
  docketNumber,
  filedOn,
  decidedOn,
  supremeCourtTerm,
  officialCitation,
  courtCode,
  showNavigation = true,
}: CaseHeaderProps) {
  const citationSuffix = caseCitationSuffix({ docketNumber, courtName, providerCourtId: courtCode, filedOn, decidedOn: decidedOn ?? null });
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <a href="/cases">Cases</a><span aria-hidden="true">/</span><span>{caseId}</span>
      </nav>
      <header className="caseHeader">
        <p className="eyebrow">{courtName}</p>
        <h1><BrandedCaseCaption caption={caption} /><span className="caseTitleCitation">{citationSuffix}</span></h1>
        <dl className="caseMeta" aria-label="Case details">
          <div><dt>Docket</dt><dd>{docketNumber}</dd></div>
          {filedOn ? <div><dt>Filed</dt><dd>{filedOn}</dd></div> : null}
          {decidedOn ? <div><dt>Decided</dt><dd>{decidedOn}</dd></div> : null}
          {supremeCourtTerm ? <div><dt>Supreme Court term</dt><dd>{supremeCourtTerm}</dd></div> : null}
          {officialCitation ? <div><dt>Official citation</dt><dd>{officialCitation}</dd></div> : null}
        </dl>
      </header>
      {showNavigation ? <CaseNav caseId={caseId} /> : null}
    </>
  );
}
