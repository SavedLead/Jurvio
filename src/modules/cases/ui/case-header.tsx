import { CaseNav } from "./case-nav";

interface CaseHeaderProps {
  caseId: string;
  caption: string;
  courtName: string;
  docketNumber: string;
  filedOn: string | null;
}

export function CaseHeader({
  caseId,
  caption,
  courtName,
  docketNumber,
  filedOn,
}: CaseHeaderProps) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <a href="/cases">Cases</a><span aria-hidden="true">/</span><span>{caseId}</span>
      </nav>
      <header className="caseHeader">
        <p className="eyebrow">{courtName}</p>
        <h1>{caption}</h1>
        <div className="caseMeta" aria-label="Case details">
          <span><strong>Docket</strong> {docketNumber}</span>
          <span><strong>Filed</strong> {filedOn ?? "Date unavailable"}</span>
          <span><strong>Jurvio ID</strong> {caseId}</span>
        </div>
      </header>
      <CaseNav caseId={caseId} />
    </>
  );
}
