import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { canIndexProfessionalProfile, getPublicAttorney } from "@/modules/directory/application/professional-directory";
import { ContactDetails, NeutralFaq } from "@/modules/directory/ui/professional-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ attorneyId: string }> }
async function load(params: Props["params"]) { const { attorneyId } = await params; return isPublicId("attorney", attorneyId) ? getPublicAttorney(db(), attorneyId) : null; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const attorney = await load(params); if (!attorney) return { title: "Attorney not found", robots: { index: false, follow: false } };
  return { title: `${attorney.displayName} — Cases and Professional Record`,
    description: `Source-backed public cases and verified professional information for ${attorney.displayName}.`,
    alternates: { canonical: `/attorneys/${attorney.publicId}` },
    robots: canIndexProfessionalProfile(attorney) ? { index: true, follow: true } : { index: false, follow: true } };
}
export default async function AttorneyPage({ params }: Props) {
  const attorney = await load(params); if (!attorney) notFound();
  const jsonLd = { "@context": "https://schema.org", "@type": "Person", name: attorney.displayName,
    identifier: attorney.publicId, url: `https://jurvio.com/attorneys/${attorney.publicId}` };
  return <main className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/attorneys">Attorneys</Link> / {attorney.publicId}</nav>
    <header className={styles.profileHeader}><p className={styles.eyebrow}>Verified professional in public court records</p><h1>{attorney.displayName}</h1>
      <p>Case relationships below come from qualifying public court records.</p><dl className={styles.facts}>
        <div><dt>Jurvio ID</dt><dd>{attorney.publicId}</dd></div><div><dt>Published cases</dt><dd>{attorney.caseCount.toLocaleString()}</dd></div>
        <div><dt>Latest filing</dt><dd>{attorney.latestCaseDate ?? "Unavailable"}</dd></div><div><dt>Identity</dt><dd>Verified</dd></div></dl></header>
    <section className={styles.section}><h2>Professional contact information</h2><ContactDetails contacts={attorney.contacts} /></section>
    {attorney.affiliations.length ? <section className={styles.section}><h2>Verified firm affiliations</h2><ol className={styles.caseList}>{attorney.affiliations.map((firm) => <li key={firm.firmPublicId}><Link href={`/law-firms/${firm.firmPublicId}` as Route}>
      <div><h3>{firm.firmName}</h3><p>{firm.title ?? "Professional affiliation"} · verified {firm.verifiedOn} · <span className={styles.sourceLink}>source available</span></p></div></Link></li>)}</ol></section> : null}
    <section className={styles.section}><h2>Published case relationships</h2><ol className={styles.caseList}>{attorney.appearances.map((appearance, index) => <li key={`${appearance.casePublicId}-${appearance.role}-${index}`}>
      <Link href={`/case/${appearance.casePublicId}` as Route}><div><h3>{appearance.caption}</h3><p>{appearance.courtName} · Docket {appearance.docketNumber} · {appearance.role}</p></div><time>{appearance.filedOn ?? "Date unavailable"}</time></Link></li>)}</ol></section>
    <NeutralFaq name={attorney.displayName} kind="attorney" caseCount={attorney.caseCount} latestCaseDate={attorney.latestCaseDate} hasContacts={attorney.contacts.length > 0} />
    <aside className={styles.disclaimer}>This profile reports sourced public professional and court-record relationships. It is not a rating, endorsement, disciplinary history, or complete professional history. Confirm current information with the linked authoritative source.</aside>
  </main>;
}
