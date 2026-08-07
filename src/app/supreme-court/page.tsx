import type { Metadata, Route } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listPublicScotusOpinions } from "@/modules/scotus/application/list-public-scotus-opinions";
import { currentJustices, officialScotusLinks } from "@/modules/scotus/domain/court-reference";
import { scotusTermLabel } from "@/modules/scotus/domain/term";
import styles from "./supreme-court.module.css";
import { robotsFor } from "@/lib/seo/indexing";

// Keep database access at runtime; unstable_cache still shares the five-minute result.\nexport const dynamic = "force-dynamic";\nexport const revalidate = 300;

const getCachedScotusDiscovery = unstable_cache(
  async () => listPublicScotusOpinions(db()),
  ["public-scotus-discovery"],
  { revalidate: 300, tags: ["public-cases", "public-scotus"] },
);

export const metadata: Metadata = {
  title: "U.S. Supreme Court Cases, Justices, Calendar and Opinions",
  description: "Follow the U.S. Supreme Court: current Justices, cases and opinions, argument calendar, orders, history, statistics, and a clear guide to the Court's process.",
  alternates: { canonical: "/supreme-court" },
  robots: robotsFor(true),
  openGraph: {
    title: "The U.S. Supreme Court, organized and explained",
    description: "Cases, opinions, Justices, schedules, history, statistics, and source-backed explanations.",
    url: "/supreme-court",
    type: "website",
  },
};

function formatDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function Term({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <Link className={styles.legalTerm} href={`/explainers/${slug}` as Route}>{children}</Link>;
}

export default async function SupremeCourtPage() {
  const discovery = await getCachedScotusDiscovery();
  const origin = siteOrigin();
  const jsonLd = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: "U.S. Supreme Court", url: `${origin}/supreme-court`,
    description: "Supreme Court cases, opinions, Justices, schedules, history, and educational context.",
    about: { "@type": "GovernmentOrganization", name: "Supreme Court of the United States", url: "https://www.supremecourt.gov/" },
    mainEntity: { "@type": "ItemList", numberOfItems: discovery.opinions.length, itemListElement: discovery.opinions.map((opinion, index) => ({
      "@type": "ListItem", position: index + 1, url: `${origin}/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}`, name: opinion.caseCaption,
    })) },
  };

  return <main className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />

    <header className={styles.hero}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Jurvio</Link><span>/</span>Supreme Court</nav>
      <div className={styles.termStatus}><span aria-hidden="true" /> October Term 2025</div>
      <h1>The Supreme Court, organized and <span className="brandHeadlineEnd">explained<span className="signatureDot" aria-hidden="true">.</span></span></h1>
      <p className={styles.lede}>Follow cases from petition to decision. Explore the Justices, calendar, orders, opinions, history, and the public record behind the Court.</p>
      <div className={styles.actions}>
        <a href="#recent-opinions">Browse recent opinions</a>
        <a href="https://www.supremecourt.gov/docket/docket.aspx">Search the official docket ↗</a>
      </div>
      <nav className={styles.sectionNav} aria-label="Supreme Court sections">
        <a href="#court-now">Court now</a><a href="#cases">Cases & process</a><a href="#justices">Justices</a>
        <a href="#recent-opinions">Opinions</a><Link href="/supreme-court/timeline">Timeline</Link><a href="#sources">Official sources</a>
      </nav>
    </header>

    <section id="court-now" className={styles.now}>
      <div className={styles.nowHeading}><div><p className={styles.sectionLabel}>The Court now</p><h2>A live term has several moving parts.</h2></div><p>Jurvio separates what the Court has agreed to hear, what has been argued, what is awaiting decision, and what has already been decided.</p></div>
      <div className={styles.statusGrid}>
        <article><span>Current membership</span><strong>9</strong><p>One Chief Justice and eight Associate Justices.</p><a href="#justices">Meet the Court ↓</a></article>
        <article><span>Argument season</span><strong>Oct–Apr</strong><p>Arguments are generally held on selected Monday, Tuesday, and Wednesday mornings.</p><a href="https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx">Current calendar ↗</a></article>
        <article><span>Decisions and orders</span><strong>Term-long</strong><p>Orders appear throughout the term. Opinions often accelerate after arguments end.</p><a href="https://www.supremecourt.gov/opinions/slipopinion/25">Latest official opinions ↗</a></article>
        <article><span>Jurvio corpus</span><strong>{discovery.caseCount.toLocaleString()}</strong><p>Supreme Court case pages currently approved for public display.</p><Link href="/cases">Browse records →</Link></article>
      </div>
      <aside className={styles.freshness}><strong>Freshness matters</strong><p>Calendar, docket, order, and opinion status can change. Jurvio links to the controlling official source and does not infer an outcome from silence or an incomplete import.</p></aside>
    </section>

    <section id="cases" className={styles.caseJourney}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionLabel}>From request to precedent</p><h2>One case. Several different statuses.</h2></div>
        <p>Most filings never reach merits briefing. A denial of review does not approve the lower court’s reasoning.</p>
      </div>
      <ol>
        <li><span>01</span><div><small>Review requested</small><h3>Petition filed</h3><p>A party asks the Court to review a lower-court judgment, usually through a petition for a writ of <Term slug="certiorari">certiorari</Term>.</p></div></li>
        <li><span>02</span><div><small>Conference stage</small><h3>Grant, deny, or hold</h3><p>At least four Justices must vote to grant review. The Court may also call for a response, request the Solicitor General’s views, relist, or hold a petition.</p></div></li>
        <li><span>03</span><div><small>Merits stage</small><h3>Briefing and argument</h3><p>The parties and amici file briefs. The Court may hear oral argument and publishes a same-day transcript.</p></div></li>
        <li><span>04</span><div><small>Decision pending</small><h3>Conference and drafting</h3><p>The Justices vote, assign an opinion, exchange drafts, and may write separate concurrences or dissents. There is no fixed public decision date.</p></div></li>
        <li><span>05</span><div><small>Decision issued</small><h3>Opinion and judgment</h3><p>The Court publishes a slip opinion. The judgment may affirm, reverse, vacate, or <Term slug="remand">remand</Term> the case for more proceedings.</p></div></li>
      </ol>
      <div className={styles.pipelineLinks}>
        <a href="https://www.supremecourt.gov/orders/grantednotedlists.aspx"><strong>Granted cases</strong><span>The Court’s official granted and noted lists →</span></a>
        <a href="https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx"><strong>Scheduled arguments</strong><span>Dates, cases, and day-call lists →</span></a>
        <a href="https://www.supremecourt.gov/opinions/slipopinion/25"><strong>Decided cases</strong><span>Slip opinions for the current term →</span></a>
        <a href="https://www.supremecourt.gov/orders/ordersofthecourt/25"><strong>Orders and petitions</strong><span>Order lists and miscellaneous orders →</span></a>
      </div>
    </section>

    <section className={styles.workload}>
      <div><p className={styles.sectionLabel}>Latest official workload snapshot</p><h2>Thousands ask. Dozens are argued.</h2><p>October Term 2024, reported by the Chief Justice in the 2025 Year-End Report. Filing totals and argued matters measure different things and should not be compared as a simple “acceptance rate.”</p><a href="https://www.supremecourt.gov/publicinfo/year-end/2025year-endreport.pdf">Read the official report ↗</a></div>
      <dl>
        <div><dt>In forma pauperis filings</dt><dd>2,527</dd></div>
        <div><dt>Paid docket filings</dt><dd>1,329</dd></div>
        <div><dt>Cases argued</dt><dd>73</dd></div>
        <div><dt>Cases disposed in signed opinions</dt><dd>64</dd></div>
        <div><dt>Signed opinions</dt><dd>56</dd></div>
        <div><dt>Per curiam opinions in argued cases</dt><dd>4</dd></div>
      </dl>
    </section>

    <section id="justices" className={styles.justices}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionLabel}>Current membership</p><h2>Nine seats. Different paths to the Court.</h2></div>
        <p>Service dates and appointing presidents are identification facts, not a measure of how a Justice will vote.</p>
      </div>
      <div className={styles.justiceGrid}>{currentJustices.map((justice, index) => <article key={justice.name}>
        <span>{String(index + 1).padStart(2, "0")}</span><small>{justice.role}</small><h3>{justice.name}</h3>
        <dl><div><dt>Joined the Court</dt><dd>{justice.joined}</dd></div><div><dt>Appointed by</dt><dd>{justice.appointingPresident}</dd></div></dl>
      </article>)}</div>
      <div className={styles.justiceLinks}><a href="https://www.supremecourt.gov/about/biographies.aspx">Official biographies ↗</a><a href="https://www.supremecourt.gov/about/members_text.aspx">Every Justice, 1789 to present ↗</a><a href="https://www.supremecourt.gov/about/circuitassignments.aspx">Circuit assignments ↗</a></div>
    </section>

    <section className={styles.historyPreview}>
      <div><p className={styles.sectionLabel}>An institution that changed</p><h2>The Court was not always nine.</h2><p>Congress changed the number of seats six times before fixing the Court at nine in 1869. Its home, jurisdiction, docket, and public access also evolved.</p><Link href="/supreme-court/timeline">Explore the filterable timeline →</Link></div>
      <ol><li><strong>1789</strong><span>Six seats authorized</span></li><li><strong>1837</strong><span>Court expands to nine</span></li><li><strong>1863</strong><span>Ten seats authorized</span></li><li><strong>1869</strong><span>Nine-seat Court established</span></li><li><strong>1935</strong><span>Current building opens</span></li></ol>
    </section>

    <section id="recent-opinions" className={styles.opinions}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionLabel}>Source-backed public records</p><h2>Recent published opinions</h2></div>
        <p>Only records that pass Jurvio’s publication controls appear here.</p>
      </div>
      {discovery.opinions.length ? <div className={styles.opinionList}>{discovery.opinions.map((opinion) => <article key={opinion.documentPublicId}>
        <div className={styles.opinionMeta}><time dateTime={opinion.filedOn ?? undefined}>{formatDate(opinion.filedOn)}</time>{scotusTermLabel(opinion.filedOn) ? <span>{scotusTermLabel(opinion.filedOn)}</span> : null}</div>
        <div><p>Docket {opinion.docketNumber}</p><h3><Link href={`/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}` as Route}>{opinion.caseCaption}</Link></h3>
          <div className={styles.tags}><span>{opinion.opinionType.replaceAll("-", " ")}</span>{opinion.perCuriam ? <span>Per curiam</span> : null}{opinion.authorName ? <span>{opinion.authorName}</span> : null}{opinion.precedentialStatus ? <span>{opinion.precedentialStatus}</span> : null}</div>
        </div><div className={styles.reading}><strong>{opinion.wordCount.toLocaleString()}</strong><span>words</span></div>
      </article>)}</div> : <div className={styles.empty}><p className={styles.sectionLabel}>Corpus status</p><h3>Opinion text is being prepared.</h3><p>{discovery.caseCount.toLocaleString()} verified Supreme Court case pages are live. Opinion documents will appear after readable text is extracted and separately verified.</p><a href="https://www.supremecourt.gov/opinions/slipopinion/25">See current official opinions ↗</a></div>}
    </section>

    <section id="sources" className={styles.sourceDirectory}>
      <div><p className={styles.sectionLabel}>Go to the record</p><h2>Official Supreme Court sources</h2><p>Use Jurvio to understand and connect the record. Use the Court’s own docket, calendars, orders, and opinions as the controlling source.</p></div>
      <nav aria-label="Official Supreme Court sources">{officialScotusLinks.map(([label, href]) => <a key={href} href={href}><span>{label}</span><b>↗</b></a>)}</nav>
    </section>
  </main>;
}
