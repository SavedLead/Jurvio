import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listPublicScotusOpinions } from "@/modules/scotus/application/list-public-scotus-opinions";
import { scotusTermLabel } from "@/modules/scotus/domain/term";
import styles from "./supreme-court.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "U.S. Supreme Court Cases and Opinions | Jurvio",
  description: "Browse published U.S. Supreme Court cases and readable, source-backed judicial opinions, with clear context about the Court and its process.",
  alternates: { canonical: "/supreme-court" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "U.S. Supreme Court Cases and Opinions",
    description: "Recent published Supreme Court opinions and a clear guide to the Court's role and process.",
    url: "/supreme-court",
    type: "website",
  },
};

function formatDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export default async function SupremeCourtPage() {
  const discovery = await listPublicScotusOpinions(db());
  const origin = siteOrigin();
  const canonicalUrl = `${origin}/supreme-court`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "U.S. Supreme Court Cases and Opinions",
    url: canonicalUrl,
    description: "Published Supreme Court opinions and educational court context.",
    about: {
      "@type": "GovernmentOrganization",
      name: "Supreme Court of the United States",
      url: "https://www.supremecourt.gov/",
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: discovery.opinions.length,
      itemListElement: discovery.opinions.map((opinion, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${origin}/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}`,
        name: opinion.caseCaption,
      })),
    },
  };

  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />

      <header className={styles.hero}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Jurvio</Link><span>/</span>Supreme Court</nav>
        <p className={styles.eyebrow}>Supreme Court of the United States</p>
        <h1>Follow the Court through the record.</h1>
        <p className={styles.lede}>Read published opinions, understand how a case reaches the Court, and trace each explanation back to public source material.</p>
        <div className={styles.actions}>
          <a href="#recent-opinions">Browse recent opinions</a>
          <Link href={"/search" as Route}>Search all published court text</Link>
        </div>
      </header>

      <section className={styles.stats} aria-label="Published Supreme Court corpus">
        <article><span>Published opinions</span><strong>{discovery.opinionCount.toLocaleString()}</strong></article>
        <article><span>Cases represented</span><strong>{discovery.caseCount.toLocaleString()}</strong></article>
        <article><span>Latest published date</span><strong>{discovery.latestFiledOn ? formatDate(discovery.latestFiledOn) : "Not available"}</strong></article>
      </section>

      <section className={styles.about}>
        <div>
          <p className={styles.sectionLabel}>The Court’s role</p>
          <h2>One Court, a limited docket, nationwide consequences.</h2>
        </div>
        <div className={styles.aboutCopy}>
          <p>The Supreme Court is the highest court in the federal judiciary. It reviews a limited number of disputes involving federal law and the Constitution, and it also has original jurisdiction in a narrow category of cases.</p>
          <p>Most matters reach the Court through a petition for a writ of certiorari. Four Justices must vote to grant review. A denial of certiorari does not decide whether the lower court was correct and does not create a Supreme Court precedent.</p>
          <div className={styles.sources}>
            <strong>Official sources</strong>
            <a href="https://www.supremecourt.gov/about/constitutional.aspx" rel="noopener">The Court and constitutional interpretation ↗</a>
            <a href="https://www.supremecourt.gov/about/procedures.aspx" rel="noopener">Supreme Court procedures ↗</a>
          </div>
        </div>
      </section>

      <section className={styles.process} aria-labelledby="process-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.sectionLabel}>A typical path</p><h2 id="process-title">How a case moves through the Court</h2></div>
          <p>Individual cases can follow a different route. The docket and orders control.</p>
        </div>
        <ol>
          <li><span>01</span><div><h3>Petition</h3><p>A party asks the Court to review a lower-court judgment.</p></div></li>
          <li><span>02</span><div><h3>Certiorari decision</h3><p>The Justices grant or deny review. Four votes are required to grant certiorari.</p></div></li>
          <li><span>03</span><div><h3>Briefing and argument</h3><p>The parties submit merits briefs. The Court may hear oral argument.</p></div></li>
          <li><span>04</span><div><h3>Opinion and judgment</h3><p>The Court announces its decision and may issue majority, concurring, or dissenting opinions.</p></div></li>
          <li><span>05</span><div><h3>Mandate and next proceedings</h3><p>The lower courts and parties act consistently with the Supreme Court’s judgment.</p></div></li>
        </ol>
      </section>

      <section id="recent-opinions" className={styles.opinions}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.sectionLabel}>Canonical public records</p><h2>Recent published opinions</h2></div>
          <p>Only opinions that pass Jurvio’s publication controls appear here.</p>
        </div>
        {discovery.opinions.length ? (
          <div className={styles.opinionList}>
            {discovery.opinions.map((opinion) => (
              <article key={opinion.documentPublicId}>
                <div className={styles.opinionMeta}>
                  <time dateTime={opinion.filedOn ?? undefined}>{formatDate(opinion.filedOn)}</time>
                  {scotusTermLabel(opinion.filedOn) ? <span>{scotusTermLabel(opinion.filedOn)}</span> : null}
                </div>
                <div>
                  <p>Docket {opinion.docketNumber}</p>
                  <h3><Link href={`/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}` as Route}>{opinion.caseCaption}</Link></h3>
                  <div className={styles.tags}>
                    <span>{opinion.opinionType.replaceAll("-", " ")}</span>
                    {opinion.perCuriam ? <span>Per curiam</span> : null}
                    {opinion.authorName ? <span>{opinion.authorName}</span> : null}
                    {opinion.precedentialStatus ? <span>{opinion.precedentialStatus}</span> : null}
                  </div>
                </div>
                <div className={styles.reading}><strong>{opinion.wordCount.toLocaleString()}</strong><span>words</span></div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <p className={styles.sectionLabel}>Corpus status</p>
            <h3>No Supreme Court opinions are approved for public display yet.</h3>
            <p>Jurvio will show opinions here after the source record, readable court text, and publication decision have been verified. Nothing is being inferred from an incomplete import.</p>
            <Link href={"/search" as Route}>Search other published legal records</Link>
          </div>
        )}
      </section>

      <section className={styles.tracking}>
        <div><p className={styles.sectionLabel}>Expansion path</p><h2>Orders and high-interest matters</h2></div>
        <div className={styles.trackingGrid}>
          <article><span>Orders and emergency applications</span><h3>Shadow-docket tracking</h3><p>This future view will follow public orders, emergency applications, and procedural developments without treating an unexplained order as a merits opinion.</p><small>Not yet populated</small></article>
          <article><span>Public-interest navigation</span><h3>Closely followed cases</h3><p>This future view will organize source-backed matters receiving sustained public interest. Placement will remain separate from legal importance or editorial judgment.</p><small>Not yet populated</small></article>
        </div>
      </section>
    </main>
  );
}
