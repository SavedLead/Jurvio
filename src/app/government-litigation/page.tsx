import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listPublicGovernmentLeads } from "@/modules/government-tracker/application/list-public-government-leads";
import styles from "./tracker.module.css";
import { robotsFor } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Federal Agency Litigation Tracker | Jurvio",
  description: "Follow reviewed, source-backed litigation leads from official DOJ, SEC, FTC, OSHA, and executive-order sources.",
  alternates: { canonical: "/government-litigation" },
  robots: robotsFor(true),
};

const agencies = [
  ["DOJ", "Department of Justice releases"],
  ["SEC", "Litigation releases"],
  ["FTC", "Enforcement and competition releases"],
  ["OSHA", "Workplace-safety releases"],
  ["Executive orders", "Federal Register presidential documents"],
] as const;

function dateLabel(value: string | null) {
  if (!value) return "Publication date unavailable";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export default async function GovernmentLitigationPage() {
  const leads = await listPublicGovernmentLeads(db());
  const origin = siteOrigin();
  const jsonLd = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: "Federal Agency Litigation Tracker", url: `${origin}/government-litigation`,
    mainEntity: { "@type": "ItemList", numberOfItems: leads.length, itemListElement: leads.map((lead, index) => ({
      "@type": "ListItem", position: index + 1, name: lead.sourceTitle,
      url: `${origin}/government-litigation/${lead.publicId}`,
    })) },
  };

  return <main className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <header className={styles.hero}>
      <nav aria-label="Breadcrumb"><Link href="/">Jurvio</Link><span>/</span>Government litigation</nav>
      <p className={styles.eyebrow}>Official-source monitoring</p>
      <h1>Follow federal litigation without the spin.</h1>
      <p>Jurvio connects reviewed agency announcements to public court records. A press release is a source lead—not proof, a judgment, or an independent Jurvio finding.</p>
    </header>

    <section className={styles.agencies} aria-label="Sources monitored">
      {agencies.map(([name, description]) => <article key={name}><strong>{name}</strong><span>{description}</span></article>)}
    </section>

    <section className={styles.explainer}>
      <div><p className={styles.eyebrow}>How this works</p><h2>Official announcement → check → court record</h2></div>
      <ol><li><strong>Discover</strong><span>We collect official agency announcements and executive orders.</span></li><li><strong>Verify</strong><span>Jurvio checks identifiers and language against source records.</span></li><li><strong>Connect</strong><span>We link to a court case only when the match is certain.</span></li></ol>
    </section>

    <section className={styles.feed}>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Latest updates</p><h2>Latest source-backed developments</h2></div><p>Allegations remain attributed to their source.</p></div>
      {leads.length ? <div className={styles.list}>{leads.map((lead) => <article key={lead.publicId}>
        <div className={styles.meta}><span>{lead.agencyCode.replace("executive_office", "Executive Office").toUpperCase()}</span><time>{dateLabel(lead.sourcePublishedAt)}</time></div>
        <h3><Link href={`/government-litigation/${lead.publicId}` as Route}>{lead.sourceTitle}</Link></h3>
        <p>{lead.attributedSummary}</p>
        <div className={styles.links}><Link href={`/government-litigation/${lead.publicId}` as Route}>Read reviewed source context</Link>{lead.casePublicId ? <Link href={`/case/${lead.casePublicId}` as Route}>View connected court record</Link> : <span>No court case linked yet</span>}</div>
      </article>)}</div> : <div className={styles.empty}><h3>No updates to show yet.</h3><p>Government announcements will appear here once each one has been checked against its official source and matched to a court case.</p><Link href={"/cases" as Route}>Browse published cases</Link></div>}
    </section>
  </main>;
}
