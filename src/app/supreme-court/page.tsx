import type { Metadata, Route } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listPublicScotusOpinions, type PublicScotusDiscovery } from "@/modules/scotus/application/list-public-scotus-opinions";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { fetchOfficialSlipOpinionIndex } from "@/modules/ingestion/providers/scotus/official-opinions";
import { fetchOfficialOrdersIndex } from "@/modules/ingestion/providers/scotus/official-orders";
import { currentJustices, officialScotusLinks } from "@/modules/scotus/domain/court-reference";
import { easternDate } from "@/modules/scotus/domain/emergency-application";
import { orderListCards, type OrderListCard } from "@/modules/scotus/domain/order-list-cards";
import { currentOctoberTerm } from "@/modules/scotus/domain/term";
import styles from "./supreme-court.module.css";
import { robotsFor } from "@/lib/seo/indexing";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { mergeRecentOpinions, type SlipOpinionCard } from "@/modules/scotus/domain/recent-opinions";

// Keep database access at runtime; unstable_cache still shares the five-minute result.
export const dynamic = "force-dynamic";

async function slipsForTerm(term: string): Promise<SlipOpinionCard[]> {
  try {
    const stored = await db()`
      SELECT s.source_record_id AS "sourceRecordId", s.filed_on::text AS "filedOn",
        s.docket_number AS "docketNumber", s.case_name AS "caseName", s.source_url AS "pdfUrl",
        matched.case_public_id AS "casePublicId", matched.document_public_id AS "documentPublicId"
      FROM scotus_slip_index s
      LEFT JOIN LATERAL (
        SELECT lc.public_id AS case_public_id, doc.public_id AS document_public_id
        FROM legal_case lc
        JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
        LEFT JOIN LATERAL (
          SELECT d.public_id
          FROM document d
          JOIN judicial_opinion j ON j.document_id = d.id
          WHERE d.case_id = lc.id AND d.publication = 'published'
            AND split_part(j.source_download_url, '#', 1) = split_part(s.source_url, '#', 1)
            AND COALESCE((
              SELECT decision.displayable FROM publication_decision decision
              WHERE decision.object_type = 'document' AND decision.object_id = d.id
              ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
            ), false)
          ORDER BY d.filed_on DESC NULLS LAST
          LIMIT 1
        ) doc ON true
        WHERE lower(lc.docket_number) = lower(s.docket_number)
          AND lc.publication = 'published'
          AND COALESCE((
            SELECT decision.displayable FROM publication_decision decision
            WHERE decision.object_type = 'legal_case' AND decision.object_id = lc.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
        ORDER BY lc.updated_at DESC
        LIMIT 1
      ) matched ON true
      WHERE s.term_year = ${term}
      ORDER BY s.filed_on DESC LIMIT 8` as SlipOpinionCard[];
    const visible = stored.filter((row) => !isRestrictedDocketText(row.caseName));
    if (visible.length) return visible;
  } catch {
    // The slip index is filled by the history job. Until then, read the Court page.
  }
  try {
    const index = await fetchOfficialSlipOpinionIndex(term);
    return index.records.slice(-8).reverse().filter((row) => !isRestrictedDocketText(row.caseName)).map((row) => ({
      sourceRecordId: row.sourceRecordId,
      filedOn: row.filedOn,
      docketNumber: row.docketNumber,
      caseName: row.caseName,
      pdfUrl: row.pdfUrl,
      casePublicId: null,
      documentPublicId: null,
    }));
  } catch {
    return [];
  }
}

const getCachedOfficialSlips = unstable_cache(
  async () => {
    const term = currentOctoberTerm(new Date());
    const current = await slipsForTerm(term.yy);
    if (current.length >= 8) return current;
    const previous = String((term.year - 1) % 100).padStart(2, "0");
    const older = await slipsForTerm(previous);
    const seen = new Set(current.map((row) => row.sourceRecordId));
    return [...current, ...older.filter((row) => !seen.has(row.sourceRecordId))]
      .sort((a, b) => b.filedOn.localeCompare(a.filedOn))
      .slice(0, 8);
  },
  ["official-slip-recent-terms"],
  { revalidate: 900 },
);

const getCachedOrderLists = unstable_cache(
  async (): Promise<OrderListCard[]> => {
    const term = currentOctoberTerm(new Date()).yy;
    const today = easternDate(new Date());
    try {
      const stored = await db()`
        SELECT list.list_date::text AS "listDate", list.label, list.source_url AS "pdfUrl", list.amended,
          EXISTS (
            SELECT 1 FROM scotus_order_list_item item
            WHERE item.list_source_record_id = list.source_record_id
          ) AS "textStored"
        FROM scotus_order_list list
        WHERE list.term_year = ${term} AND list.list_kind = 'order_list'
        ORDER BY list.list_date DESC
        LIMIT 12` as OrderListCard[];
      const cards = orderListCards(stored, today);
      if (cards.length) return cards;
    } catch {
      // Migration 0201 may not be applied yet. The Court's index is the page.
    }
    try {
      const index = await fetchOfficialOrdersIndex(term);
      return orderListCards(index.entries.filter((entry) => entry.kind === "order_list").map((entry) => ({
        listDate: entry.listDate,
        label: entry.label,
        pdfUrl: entry.sourceUrl,
        amended: entry.amended,
        textStored: false,
      })), today).slice(0, 12);
    } catch {
      return [];
    }
  },
  ["official-order-lists-current-term"],
  { revalidate: 900 },
);

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

const emptyDiscovery: PublicScotusDiscovery = {
  courtName: "Supreme Court of the United States",
  courtPublicId: null,
  opinionCount: 0,
  caseCount: 0,
  caseCountAvailable: false,
  latestFiledOn: null,
  opinions: [],
};

export default async function SupremeCourtPage() {
  let discovery = emptyDiscovery;
  let officialSlips: SlipOpinionCard[] = [];
  let orderLists: OrderListCard[] = [];
  try {
    [discovery, officialSlips, orderLists] = await Promise.all([
      getCachedScotusDiscovery(), getCachedOfficialSlips(), getCachedOrderLists(),
    ]);
  } catch {
    discovery = emptyDiscovery;
    officialSlips = [];
    orderLists = [];
  }
  const today = easternDate(new Date());
  const recentOpinions = mergeRecentOpinions(discovery.opinions, officialSlips, today);
  const term = currentOctoberTerm(new Date());
  const slipOpinionsUrl = `https://www.supremecourt.gov/opinions/slipopinion/${term.yy}`;
  const ordersUrl = `https://www.supremecourt.gov/orders/ordersofthecourt/${term.yy}`;
  const sourceLinks = officialScotusLinks(new Date());
  const origin = siteOrigin();
  const jsonLd = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: "U.S. Supreme Court", url: `${origin}/supreme-court`,
    description: "Supreme Court cases, opinions, Justices, schedules, history, and educational context.",
    about: { "@type": "GovernmentOrganization", name: "Supreme Court of the United States", url: "https://www.supremecourt.gov/" },
    mainEntity: { "@type": "ItemList", numberOfItems: recentOpinions.length, itemListElement: recentOpinions.map((opinion, index) => ({
      "@type": "ListItem", position: index + 1,
      url: opinion.casePath ? `${origin}${opinion.casePath}` : `${origin}/supreme-court`,
      name: cleanCaseCaption(opinion.caseName),
    })) },
  };

  return <main className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />

    <header className={styles.hero}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Jurvio</Link><span>/</span>Supreme Court</nav>
      <div className={styles.termStatus}><span aria-hidden="true" /> {term.label}</div>
      <h1>The Supreme Court, organized and <span className="brandHeadlineEnd">explained<span className="signatureDot" aria-hidden="true">.</span></span></h1>
      <p className={styles.lede}>Follow cases from petition to decision. Explore the Justices, calendar, orders, opinions, history, and the public record behind the Court.</p>
      <div className={styles.actions}>
        <a href="#recent-opinions">Browse recent opinions</a>
        <Link href={"/supreme-court/emergency" as Route}>Emergency applications</Link>
        <a href="https://www.supremecourt.gov/docket/docket.aspx">Search the official docket ↗</a>
      </div>
      <nav className={styles.sectionNav} aria-label="Supreme Court sections">
        <a href="#court-now">Court now</a><a href="#cases">Cases & process</a><a href="#justices">Justices</a>
        <a href="#orders">Orders</a><a href="#recent-opinions">Opinions</a><Link href="/supreme-court/timeline">Timeline</Link><Link href={"/supreme-court/emergency" as Route}>Emergency docket</Link><a href="#sources">Official sources</a>
      </nav>
    </header>

    <section id="court-now" className={styles.now}>
      <div className={styles.nowHeading}><div><p className={styles.sectionLabel}>The Court now</p><h2>A live term has several moving parts.</h2></div><p>Jurvio separates what the Court has agreed to hear, what has been argued, what is awaiting decision, and what has already been decided.</p></div>
      <div className={styles.statusGrid}>
        <article><span>Current membership</span><strong>9</strong><p>One Chief Justice and eight Associate Justices.</p><a href="#justices">Meet the Court ↓</a></article>
        <article><span>Argument season</span><strong>Oct–Apr</strong><p>Arguments are generally held on selected Monday, Tuesday, and Wednesday mornings.</p><a href="https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx">Current calendar ↗</a></article>
        <article><span>Decisions and orders</span><strong>Term-long</strong><p>Orders appear throughout the term. Opinions often accelerate after arguments end.</p><a href={slipOpinionsUrl}>Latest official opinions ↗</a></article>
        <article><span>Jurvio corpus</span><strong>{discovery.caseCountAvailable ? discovery.caseCount.toLocaleString() : "—"}</strong><p>{discovery.caseCountAvailable ? "Supreme Court cases you can read about on Jurvio." : "The published-case total is refreshing."}</p><Link href="/cases">Browse records →</Link></article>
      </div>
      <aside className={styles.freshness}><strong>Freshness matters</strong><p>Calendar, docket, order, and opinion status can change. Jurvio links to the controlling official source and does not infer an outcome from silence or an incomplete import.</p></aside>
    </section>

    <section id="cases" className={styles.caseJourney}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionLabel}>From request to precedent</p><h2>One case. Several different statuses.</h2></div>
        <p>Most filings never reach merits briefing. A denial of review does not approve the lower court’s reasoning.</p>
      </div>
      <ol>
        <li><span>01</span><div><small>Review requested</small><h3>Petition filed</h3><p>A party asks the Court to review a lower-court judgment, usually through a petition for a writ of <Term slug="writ-of-certiorari">certiorari</Term>.</p></div></li>
        <li><span>02</span><div><small>Conference stage</small><h3>Grant, deny, or hold</h3><p>At least four Justices must vote to grant review. The Court may also call for a response, request the Solicitor General’s views, relist, or hold a petition.</p></div></li>
        <li><span>03</span><div><small>Merits stage</small><h3>Briefing and argument</h3><p>The parties and amici file briefs. The Court may hear oral argument and publishes a same-day transcript.</p></div></li>
        <li><span>04</span><div><small>Decision pending</small><h3>Conference and drafting</h3><p>The Justices vote, assign an opinion, exchange drafts, and may write separate concurrences or dissents. There is no fixed public decision date.</p></div></li>
        <li><span>05</span><div><small>Decision issued</small><h3>Opinion and judgment</h3><p>The Court publishes a slip opinion. The judgment may affirm, reverse, vacate, or <Term slug="remand">remand</Term> the case for more proceedings.</p></div></li>
      </ol>
      <div className={styles.pipelineLinks}>
        <a href="https://www.supremecourt.gov/orders/grantednotedlists.aspx"><strong>Granted cases</strong><span>The Court’s official granted and noted lists →</span></a>
        <a href="https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx"><strong>Scheduled arguments</strong><span>Dates, cases, and day-call lists →</span></a>
        <a href={slipOpinionsUrl}><strong>Decided cases</strong><span>Slip opinions for {term.label} →</span></a>
        <a href={ordersUrl}><strong>Orders and petitions</strong><span>Order lists and miscellaneous orders →</span></a>
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
      <div className={styles.justiceLinks}><Link href={"/justices" as Route}>Voting records and analytics →</Link><Link href={"/justices/agreement" as Route}>Who votes with whom →</Link><a href="https://www.supremecourt.gov/about/biographies.aspx">Official biographies ↗</a><a href="https://www.supremecourt.gov/about/members_text.aspx">Every Justice, 1789 to present ↗</a><a href="https://www.supremecourt.gov/about/circuitassignments.aspx">Circuit assignments ↗</a></div>
    </section>

    <section className={styles.historyPreview}>
      <div><p className={styles.sectionLabel}>An institution that changed</p><h2>The Court was not always nine.</h2><p>Congress changed the number of seats six times before fixing the Court at nine in 1869. Its home, jurisdiction, docket, and public access also evolved.</p><Link href="/supreme-court/timeline">Explore the filterable timeline →</Link></div>
      <ol><li><strong>1789</strong><span>Six seats authorized</span></li><li><strong>1837</strong><span>Court expands to nine</span></li><li><strong>1863</strong><span>Ten seats authorized</span></li><li><strong>1869</strong><span>Nine-seat Court established</span></li><li><strong>1935</strong><span>Current building opens</span></li></ol>
    </section>

    <section id="orders" className={styles.opinions}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionLabel}>Orders of the Court</p><h2>Order lists for {term.label}</h2></div>
        <p>Each row is the Court’s PDF. When Jurvio has read the lines, they also appear on the matching case. Until then, the PDF is the record. Nothing here is emailed.</p>
      </div>
      {orderLists.length ? <div className={styles.opinionList}>{orderLists.map((order) => <article key={order.pdfUrl}>
        <div className={styles.opinionMeta}><time dateTime={order.listDate}>{formatDate(order.listDate)}</time>{order.amended ? <span>Amended</span> : null}</div>
        <div>
          <p>{order.textStored ? "Lines are on the matching cases" : "Official PDF"} · <a href={order.pdfUrl}>Official PDF</a></p>
          <h3>{order.label}</h3>
        </div>
        <div className={styles.reading} />
      </article>)}</div> : <div className={styles.empty}><p className={styles.sectionLabel}>Orders</p><h3>The order-list index did not load.</h3><p>The Court’s own page is the list until Jurvio can read it again.</p><a href={ordersUrl}>Orders of the Court ↗</a></div>}
    </section>

    <section id="recent-opinions" className={styles.opinions}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionLabel}>Source-backed public records</p><h2>Recent published opinions</h2></div>
        <p>Each opinion is listed once. The case name opens the Jurvio case. The opinion page and the Court’s PDF are separate links.</p>
      </div>
      {recentOpinions.length ? <div className={styles.opinionList}>{recentOpinions.map((opinion) => <article key={opinion.key}>
        <div className={styles.opinionMeta}><time dateTime={opinion.filedOn ?? undefined}>{formatDate(opinion.filedOn)}</time>{opinion.termLabel ? <span>{opinion.termLabel}</span> : null}</div>
        <div>
          <p>Docket {opinion.docketNumber}
            {opinion.documentPath ? <> · <Link href={opinion.documentPath as Route}>Opinion</Link></> : null}
            {opinion.pdfUrl ? <> · <a href={opinion.pdfUrl}>Official PDF</a></> : null}
          </p>
          <h3>{opinion.casePath ? <Link href={opinion.casePath as Route}>{cleanCaseCaption(opinion.caseName)}</Link> : cleanCaseCaption(opinion.caseName)}</h3>
          <div className={styles.tags}>{opinion.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
        </div>
        <div className={styles.reading}>{opinion.wordCount > 0 ? <><strong>{opinion.wordCount.toLocaleString()}</strong><span>words</span></> : null}</div>
      </article>)}</div> : <div className={styles.empty}><p className={styles.sectionLabel}>Opinions</p><h3>No published opinion is on this list.</h3><p>{discovery.caseCountAvailable ? `${discovery.caseCount.toLocaleString()} Supreme Court cases are published on Jurvio. ` : ""}The Court’s {term.label} slip index did not load.</p><a href={slipOpinionsUrl}>See {term.label} official opinions ↗</a></div>}
    </section>

    <section id="sources" className={styles.sourceDirectory}>
      <div><p className={styles.sectionLabel}>Go to the record</p><h2>Official Supreme Court sources</h2><p>Use Jurvio to understand and connect the record. Use the Court’s own docket, calendars, orders, and opinions as the controlling source.</p></div>
      <nav aria-label="Official Supreme Court sources">{sourceLinks.map(([label, href]) => <a key={href} href={href}><span>{label}</span><b>↗</b></a>)}</nav>
      <p>Public feeds, not email: <a href="/feeds/scotus">all activity</a>, <a href="/feeds/scotus/emergency">emergency docket</a>, <a href="/feeds/scotus/administration">administration (automatic, approximate)</a>.</p>
    </section>
  </main>;
}
