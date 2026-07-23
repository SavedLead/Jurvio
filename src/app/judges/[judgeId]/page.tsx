import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { getPublicJudge } from "@/modules/directory/application/judicial-directory";
import styles from "@/modules/directory/ui/directory.module.css";
import judicialStyles from "@/modules/directory/ui/judicial-directory.module.css";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ judgeId: string }> }
async function load(params: Props["params"]) { const { judgeId } = await params; return isPublicId("judge", judgeId) ? getPublicJudge(db(), judgeId) : null; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const judge = await load(params); if (!judge) return { title: "Judge not found", robots: { index: false, follow: false } };
  const indexable = judge.indexable && judge.verification === "verified" && judge.appointments.length > 0 && judge.caseCount > 0;
  return { title: `${judge.displayName} — Court Service and Published Cases`, description: `Verified court service and sourced public case relationships for ${judge.displayName}.`,
    alternates: { canonical: `/judges/${judge.publicId}` }, robots: indexable ? { index: true, follow: true } : { index: false, follow: true } };
}
export default async function JudgePage({ params }: Props) {
  const judge = await load(params); if (!judge) notFound();
  const jsonLd = { "@context": "https://schema.org", "@type": "Person", name: judge.displayName, identifier: judge.publicId, url: `https://jurvio.com/judges/${judge.publicId}` };
  return <main className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/judges">Judges</Link> / {judge.publicId}</nav>
    <header className={styles.profileHeader}><p className={styles.eyebrow}>Verified judicial profile</p><h1>{judge.displayName}</h1><p>Official appointment information and qualifying public court-record relationships.</p>
      <dl className={styles.facts}><div><dt>Jurvio ID</dt><dd>{judge.publicId}</dd></div><div><dt>Published cases</dt><dd>{judge.caseCount.toLocaleString()}</dd></div><div><dt>Current/last court</dt><dd>{judge.courtName}</dd></div><div><dt>Identity</dt><dd>Verified</dd></div></dl></header>
    <p><a className={styles.sourceLink} href={judge.authoritativeSourceUrl} rel="nofollow noopener">View authoritative identity source</a></p>
    <section className={styles.section}><h2>Judicial appointments and tenure</h2><ol className={judicialStyles.appointmentList}>{judge.appointments.map((appointment, index) => <li className={judicialStyles.appointment} key={`${appointment.courtPublicId}-${appointment.positionTitle}-${index}`}>
      <h3>{appointment.positionTitle}</h3><p><Link href={`/courts/${appointment.courtPublicId}` as Route}>{appointment.courtName}</Link></p>
      <p>{appointment.serviceStartedOn ?? "Start date unavailable"} – {appointment.serviceEndedOn ?? "Present or end date unavailable"}</p>
      {appointment.appointedByName ? <p>Appointing authority: {appointment.appointedByName}{appointment.appointedByOffice ? `, ${appointment.appointedByOffice}` : ""}</p> : null}
      <p><a href={appointment.sourceUrl} rel="nofollow noopener">Appointment source</a> · verified {appointment.verifiedOn}</p>
    </li>)}</ol></section>
    <aside className={judicialStyles.policyNote}><strong>Political-party labels are not inferred.</strong> Jurvio does not treat an appointing president, court location, case outcome, or judicial vote as evidence of a judge&apos;s personal political affiliation.</aside>
    <section className={styles.section}><h2>Published case relationships</h2><ol className={styles.caseList}>{judge.cases.map((legalCase) => <li key={`${legalCase.publicId}-${legalCase.relationshipType}`}><Link href={`/case/${legalCase.publicId}` as Route}>
      <div><h3>{legalCase.caption}</h3><p>{legalCase.courtName} · Docket {legalCase.docketNumber} · {legalCase.relationshipType.replaceAll("_", " ")}</p></div><time>{legalCase.filedOn ?? "Date unavailable"}</time>
    </Link></li>)}</ol></section>
    <aside className={styles.disclaimer}>This neutral profile summarizes sourced official appointments and public court records. It does not rate the judge, predict outcomes, or characterize judicial philosophy.</aside>
  </main>;
}

