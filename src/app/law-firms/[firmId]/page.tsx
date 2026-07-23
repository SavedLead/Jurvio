import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { canIndexDirectoryProfile, getPublicEntity } from "@/modules/directory/application/public-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ firmId: string }> }
async function load(params: Props["params"]) {
  const { firmId } = await params;
  if (!isPublicId("entity", firmId) && !isPublicId("firm", firmId)) return null;
  return getPublicEntity(db(), firmId, "law_firm");
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const firm = await load(params);
  if (!firm) return { title: "Law firm not found", robots: { index: false, follow: false } };
  return { title: `${firm.displayName} — Cases and Court Records`,
    description: `Published court cases connected to ${firm.displayName} on Jurvio.`,
    alternates: { canonical: `/law-firms/${firm.publicId}` },
    robots: canIndexDirectoryProfile(firm) ? { index: true, follow: true } : { index: false, follow: true } };
}
export default async function LawFirmPage({ params }: Props) {
  const firm = await load(params); if (!firm) notFound();
  const jsonLd = { "@context": "https://schema.org", "@type": "Organization", name: firm.displayName,
    identifier: firm.publicId, url: `https://jurvio.com/law-firms/${firm.publicId}` };
  return <main className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/law-firms">Law firms</Link> / {firm.publicId}</nav>
    <header className={styles.profileHeader}><p className={styles.eyebrow}>Law firm in public court records</p><h1>{firm.displayName}</h1>
      <p>Source-backed litigation relationships published by Jurvio.</p><dl className={styles.facts}>
        <div><dt>Jurvio ID</dt><dd>{firm.publicId}</dd></div><div><dt>Public cases</dt><dd>{firm.caseCount.toLocaleString()}</dd></div>
        <div><dt>Latest filing</dt><dd>{firm.latestCaseDate ?? "Unavailable"}</dd></div><div><dt>Verification</dt><dd>{firm.verification.replaceAll("_", " ")}</dd></div></dl></header>
    <section className={styles.section}><h2>Published case relationships</h2><ol className={styles.caseList}>{firm.appearances.map((appearance, index) => <li key={`${appearance.casePublicId}-${appearance.role}-${index}`}>
      <Link href={`/case/${appearance.casePublicId}` as Route}><div><h3>{appearance.caption}</h3><p>{appearance.courtName} · Docket {appearance.docketNumber} · {appearance.role}</p></div><time>{appearance.filedOn ?? "Date unavailable"}</time></Link>
    </li>)}</ol></section>
    <aside className={styles.disclaimer}>This profile reflects relationships stated in qualifying public court records. It does not represent an endorsement, rating, or complete history of the firm.</aside>
  </main>;
}
