import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { canIndexDirectoryProfile, getPublicCourt } from "@/modules/directory/application/public-directory";
import styles from "@/modules/directory/ui/directory.module.css";
import { robotsFor } from "@/lib/seo/indexing";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { circuitJusticeFor, circuitOfCourt } from "@/modules/scotus/domain/circuit-justice";
import { CircuitJusticeBox } from "@/modules/scotus/ui/circuit-justice-box";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ courtId: string }> }
// generateMetadata and the page share one lookup per request. The count and the
// newest-cases list come from court_public_stats (see public-directory-stats).
const loadCourt = cache(async (courtId: string) => isPublicId("court", courtId) ? getPublicCourt(db(), courtId) : null);
async function load(params: Props["params"]) {
  const { courtId } = await params;
  return loadCourt(courtId);
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const court = await load(params); if (!court) return { title: "Court not found", robots: { index: false, follow: false } };
  return { title: `${court.name} — Cases and Court Information`,
    description: `Browse published cases and source-backed information for ${court.name}.`,
    alternates: { canonical: `/courts/${court.publicId}` },
    robots: robotsFor(canIndexDirectoryProfile(court)) };
}
export default async function CourtPage({ params }: Props) {
  const court = await load(params); if (!court) notFound();
  const circuitJustice = circuitJusticeFor(court.providerCourtId);
  const isCircuit = circuitJustice !== null && circuitOfCourt(court.providerCourtId) === (court.providerCourtId ?? "").toLowerCase();
  const jsonLd = { "@context": "https://schema.org", "@type": "GovernmentOrganization", name: court.name,
    identifier: court.publicId, url: `https://jurvio.com/courts/${court.publicId}` };
  return <main className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/courts">Courts</Link> / {court.publicId}</nav>
    <header className={styles.profileHeader}><p className={styles.eyebrow}>Court directory</p><h1>{court.name}</h1>
      <p>{court.shortName ? `${court.shortName}. ` : ""}Published case information connected to this court.</p>
      <dl className={styles.facts}><div><dt>Jurvio ID</dt><dd>{court.publicId}</dd></div><div><dt>Jurisdiction</dt><dd>{court.jurisdiction ?? "Unavailable"}</dd></div>
        <div><dt>Public cases</dt><dd>{court.caseCount.toLocaleString()}</dd></div><div><dt>Verification</dt><dd>{court.verification.replaceAll("_", " ")}</dd></div></dl></header>
    {circuitJustice ? <CircuitJusticeBox justice={circuitJustice} relation={isCircuit ? "circuit" : "court-in-circuit"} /> : null}
    {court.sourceUrl ? <p><a className={styles.sourceLink} href={court.sourceUrl} rel="nofollow noopener">View official/source court information</a></p> : null}
    <section className={styles.section}><h2>Recent published cases</h2><ol className={styles.caseList}>{court.cases.map((legalCase) => <li key={legalCase.publicId}>
      <Link href={`/case/${legalCase.publicId}` as Route}><div><h3>{cleanCaseCaption(legalCase.caption)}</h3><p>Docket {legalCase.docketNumber}</p></div><time>{legalCase.filedOn ?? "Date unavailable"}</time></Link>
    </li>)}</ol></section>
    <aside className={styles.disclaimer}>Jurvio organizes qualifying public records for readability. Court details and case status should be confirmed against the linked source or the court’s official system.</aside>
  </main>;
}
