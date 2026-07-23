import type { ReactNode } from "react";
import Link from "next/link";
import type { PublicCase } from "../application/get-public-case";
import { CaseNav, type CaseSection } from "./case-nav";
import styles from "./case-workspace.module.css";

function words(value: string) {
  return value.replaceAll("_", " ");
}

export function CaseWorkspace({ legalCase, active, children }: {
  legalCase: PublicCase;
  active: CaseSection;
  children: ReactNode;
}) {
  const verified = legalCase.verification === "verified";
  const explanation = verified && legalCase.statusExplanation
    ? legalCase.statusExplanation
    : "The current status has not been verified from a qualifying court event.";
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/cases">Cases</Link><span>/</span><span>{legalCase.publicId}</span></nav>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>{legalCase.courtName}</p>
      <h1>{legalCase.caption}</h1>
      <div className={styles.identifiers}><span>Docket {legalCase.docketNumber}</span>{legalCase.filedOn ? <span>Filed {legalCase.filedOn}</span> : null}<span>Jurvio record {legalCase.publicId}</span></div>
    </header>
    <section className={verified ? styles.status : `${styles.status} ${styles.unverified}`} aria-labelledby="case-status-heading">
      <div><p className={styles.statusLabel}>Current status</p><h2 id="case-status-heading">{verified ? words(legalCase.activityState) : "Verification pending"}</h2><p>{explanation}</p></div>
      <dl>
        <div><dt>Phase</dt><dd>{verified ? words(legalCase.proceduralPhase) : "Not verified"}</dd></div>
        <div><dt>Disposition</dt><dd>{verified ? words(legalCase.dispositionScope) : "Not verified"}</dd></div>
        <div><dt>Judgment</dt><dd>{verified ? words(legalCase.judgmentState) : "Not verified"}</dd></div>
        <div><dt>Appeal</dt><dd>{verified ? words(legalCase.appealState) : "Not verified"}</dd></div>
      </dl>
    </section>
    <CaseNav caseId={legalCase.publicId} active={active} />
    <div className={styles.content}>{children}</div>
  </main>;
}
