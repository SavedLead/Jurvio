import { CaseNav } from "./case-nav";
import { BrandedCaseCaption } from "./branded-case-caption";

interface CaseHeaderProps {
  caseId: string;
  caption: string;
  courtName: string;
  docketNumber: string;
  filedOn: string | null;
  showNavigation?: boolean;
}

export function CaseHeader({
  caseId,
  caption,
  courtName,
  docketNumber,
  filedOn,
  showNavigation = true,
}: CaseHeaderProps) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <a href="/cases">Cases</a><span aria-hidden="true">/</span><span>{caseId}</span>
      </nav>
      <header className="caseHeader">
        <p className="eyebrow">{courtName}</p>
        <h1><BrandedCaseCaption caption={caption} /></h1>
        <dl className="caseMeta" aria-label="Case details">
          <div><dt>Docket</dt><dd>{docketNumber}</dd></div>
          {filedOn ? <div><dt>Filed or decided</dt><dd>{filedOn}</dd></div> : null}
        </dl>
      </header>
      {showNavigation ? <CaseNav caseId={caseId} /> : null}
    </>
  );
}
