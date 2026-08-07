import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { getPublicGovernmentLead } from "@/modules/government-tracker/application/list-public-government-leads";
import { allegationNotice } from "@/modules/government-tracker/domain/publication-policy";
import styles from "../tracker.module.css";
import { robotsFor } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leadId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { leadId } = await params;
  const lead = await getPublicGovernmentLead(db(), leadId);
  if (!lead) return { title: "Source lead not found | Jurvio", robots: { index: false, follow: false } };
  return { title: `${lead.sourceTitle} | Jurvio`, description: lead.attributedSummary, alternates: { canonical: `/government-litigation/${lead.publicId}` }, robots: robotsFor(true) };
}

export default async function GovernmentLeadPage({ params }: Props) {
  const { leadId } = await params;
  const lead = await getPublicGovernmentLead(db(), leadId);
  if (!lead) notFound();
  const canonicalUrl = `${siteOrigin()}/government-litigation/${lead.publicId}`;
  const jsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: lead.sourceTitle, url: canonicalUrl, citation: lead.sourceUrl, datePublished: lead.sourcePublishedAt };

  return <main className={`${styles.page} ${styles.detail}`}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Jurvio</Link><span>/</span><Link href={"/government-litigation" as Route}>Government litigation</Link><span>/</span>Source lead</nav>
    <header className={styles.detailHero}><p className={styles.eyebrow}>{lead.agencyName}</p><h1>{lead.sourceTitle}</h1><p>{lead.attributedSummary}</p></header>
    <aside className={styles.notice}><strong>Important context</strong><p>{allegationNotice(lead.agencyName)} The linked official release and court record control if anything on this page differs.</p></aside>
    <div className={styles.detailGrid}>
      <section><p className={styles.eyebrow}>Source record</p><h2>What Jurvio verified</h2><dl><div><dt>Official source</dt><dd>{lead.agencyName}</dd></div><div><dt>Source type</dt><dd>{lead.sourceKind.replaceAll("_", " ")}</dd></div><div><dt>Court connection</dt><dd>{lead.casePublicId ? "Reviewed match published" : "No verified match published"}</dd></div></dl></section>
      <aside><h2>Primary links</h2><a href={lead.sourceUrl} rel="noopener noreferrer">Read the official source ↗</a>{lead.casePublicId ? <Link href={`/case/${lead.casePublicId}` as Route}>Open {lead.caseCaption ?? "the connected case"}</Link> : null}{lead.docketNumber ? <p>Docket {lead.docketNumber}</p> : null}</aside>
    </div>
  </main>;
}
