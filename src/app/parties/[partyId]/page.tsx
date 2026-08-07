import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { canIndexDirectoryProfile, getPublicEntity } from "@/modules/directory/application/public-directory";
import styles from "@/modules/directory/ui/directory.module.css";
import { robotsFor } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ partyId: string }> }
async function load(params: Props["params"]) {
  const { partyId } = await params;
  if (!isPublicId("entity", partyId)) return null;
  return getPublicEntity(db(), partyId, "party");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const party = await load(params);
  if (!party) return { title: "Party not found", robots: { index: false, follow: false } };
  return {
    title: `${party.displayName} — Public Court Cases`,
    description: `Public court cases involving ${party.displayName}, with source-backed court and docket information.`,
    alternates: { canonical: `/parties/${party.publicId}` },
    robots: robotsFor(canIndexDirectoryProfile(party)),
  };
}

export default async function PartyPage({ params }: Props) {
  const party = await load(params);
  if (!party) notFound();
  const jsonLd = { "@context": "https://schema.org", "@type": "Thing", name: party.displayName,
    identifier: party.publicId, url: `https://jurvio.com/parties/${party.publicId}` };
  return <main className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/parties">Parties</Link> / {party.publicId}</nav>
    <header className={styles.profileHeader}><p className={styles.eyebrow}>Party in public court records</p><h1>{party.displayName}</h1>
      <p>Jurvio found {party.caseCount.toLocaleString()} published {party.caseCount === 1 ? "case" : "cases"} connected to this source identity.</p>
      <dl className={styles.facts}><div><dt>Jurvio ID</dt><dd>{party.publicId}</dd></div><div><dt>Entity classification</dt><dd>{party.entityType}</dd></div>
        <div><dt>Public cases</dt><dd>{party.caseCount.toLocaleString()}</dd></div><div><dt>Verification</dt><dd>{party.verification.replaceAll("_", " ")}</dd></div></dl>
    </header>
    <section className={styles.section}><h2>Cases involving this party</h2><ol className={styles.caseList}>{party.appearances.map((appearance, index) => <li key={`${appearance.casePublicId}-${appearance.role}-${index}`}>
      <Link href={`/case/${appearance.casePublicId}` as Route}><div><h3>{appearance.caption}</h3><p>{appearance.courtName} · Docket {appearance.docketNumber} · {appearance.role}</p></div><time>{appearance.filedOn ?? "Date unavailable"}</time></Link>
    </li>)}</ol></section>
    <aside className={styles.disclaimer}><strong>Important context:</strong> A court-record appearance does not establish wrongdoing, liability, or guilt. Names can be shared by different people or organizations. This page reports source-backed case relationships and should not be used as a background-check conclusion.</aside>
  </main>;
}
