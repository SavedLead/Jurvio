import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { getQualifiedCourt } from "@/modules/directory/application/judicial-directory";
import styles from "@/modules/directory/ui/directory.module.css";
import judicialStyles from "@/modules/directory/ui/judicial-directory.module.css";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ courtId: string }> }
async function load(params: Props["params"]) {
  const { courtId } = await params; if (!isPublicId("court", courtId)) return null;
  return getQualifiedCourt(db(), courtId);
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const court = await load(params); if (!court) return { title: "Court not found", robots: { index: false, follow: false } };
  return { title: `${court.name} — Cases and Court Information`,
    description: `Browse published cases and source-backed information for ${court.name}.`,
    alternates: { canonical: `/courts/${court.publicId}` },
    robots: court.indexable && court.verification === "verified" && court.caseCount > 0 ? { index: true, follow: true } : { index: false, follow: true } };
}
export default async function CourtPage({ params }: Props) {
  const court = await load(params); if (!court) notFound();
  const jsonLd = { "@context": "https://schema.org", "@type": "GovernmentOrganization", name: court.name,
    identifier: court.publicId, url: `https://jurvio.com/courts/${court.publicId}` };
  return <main className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/courts">Courts</Link> / {court.publicId}</nav>
    <header className={styles.profileHeader}><p className={styles.eyebrow}>Court directory</p><h1>{court.name}</h1>
      <p>{court.shortName ? `${court.shortName}. ` : ""}Published case information connected to this court.</p>
      <dl className={styles.facts}><div><dt>Jurvio ID</dt><dd>{court.publicId}</dd></div><div><dt>Jurisdiction</dt><dd>{court.jurisdiction ?? "Unavailable"}</dd></div>
        <div><dt>Public cases</dt><dd>{court.caseCount.toLocaleString()}</dd></div><div><dt>Verification</dt><dd>{court.verification.replaceAll("_", " ")}</dd></div></dl></header>
    <p><a className={styles.sourceLink} href={court.sourceUrl} rel="nofollow noopener">View official/source court information</a></p>
    {court.roleSummary && court.jurisdictionSummary && court.detailSourceUrl ? <section className={styles.section}><h2>Understanding this court</h2><div className={judicialStyles.explainers}>
      <article className={judicialStyles.explainer}><h3>What this court does</h3><p>{court.roleSummary}</p></article>
      <article className={judicialStyles.explainer}><h3>What it can hear</h3><p>{court.jurisdictionSummary}</p></article>
      {court.geographicScope ? <article className={judicialStyles.explainer}><h3>Geographic area</h3><p>{court.geographicScope}</p></article> : null}
      <article className={judicialStyles.explainer}><h3>Source</h3><p><a href={court.detailSourceUrl} rel="nofollow noopener">Official court description</a>{court.detailVerifiedOn ? ` · verified ${court.detailVerifiedOn}` : ""}</p></article>
    </div></section> : null}
    {court.judges.length ? <section className={styles.section}><h2>Verified judicial appointments</h2><ol className={styles.caseList}>{court.judges.map((judge) => <li key={`${judge.publicId}-${judge.positionTitle}`}><Link href={`/judges/${judge.publicId}` as Route}>
      <div><h3>{judge.displayName}</h3><p>{judge.positionTitle} · {judge.serviceStartedOn ?? "Start unavailable"} – {judge.serviceEndedOn ?? "present or end unavailable"}</p></div>
    </Link></li>)}</ol><aside className={judicialStyles.policyNote}>Jurvio reports sourced appointments and tenure dates. It does not infer a judge&apos;s political party from an appointing authority.</aside></section> : null}
    <section className={styles.section}><h2>Recent published cases</h2><ol className={styles.caseList}>{court.cases.map((legalCase) => <li key={legalCase.publicId}>
      <Link href={`/case/${legalCase.publicId}` as Route}><div><h3>{legalCase.caption}</h3><p>Docket {legalCase.docketNumber}</p></div><time>{legalCase.filedOn ?? "Date unavailable"}</time></Link>
    </li>)}</ol></section>
    <aside className={styles.disclaimer}>Jurvio organizes qualifying public records for readability. Court details and case status should be confirmed against the linked source or the court’s official system.</aside>
  </main>;
}
