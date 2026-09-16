import Link from "next/link";
import { unstable_cache } from "next/cache";
import { formatEasternDate } from "@/lib/time/eastern";
import type { Route } from "next";
import { db } from "@/db/client";
import { listRecentlyUpdatedPublicCases } from "@/modules/cases/application/list-recently-updated-public-cases";
import { BrandedCaseCaption } from "@/modules/cases/ui/branded-case-caption";

const browseItems = [
  ["Cases", "Search opinions, dockets, filings, and decisions", "/cases", "01"],
  ["Parties", "Research the people and organizations named in litigation", "/parties", "02"],
  ["Attorneys", "Find counsel, firms, appearances, and case history", "/attorneys", "03"],
  ["Judges", "Explore judicial records, courts, and written opinions", "/judges", "04"],
  ["Courts", "Browse jurisdictions and understand how they work", "/courts", "05"],
  ["Explainers", "Understand legal terms, procedure, jurisdiction, and doctrine", "/explainers", "06"],
] as const;

const startingPaths = [
  {
    label: "Find a case",
    description: "Search by case name, party, docket number, court, citation, or legal issue.",
    href: "/cases",
    action: "Search federal cases",
  },
  {
    label: "Research a person or company",
    description: "Follow a name across verified cases, parties, attorneys, and connected records.",
    href: "/parties",
    action: "Explore parties",
  },
  {
    label: "Understand a legal issue",
    description: "Start with a plain-English question and reach the source-backed law and record.",
    href: "/search",
    action: "Ask Jurvio",
  },
] as const;

const activityItems = [
  {
    label: "Supreme Court",
    title: "Follow opinions and understand what each decision changes.",
    detail: "Term-organized coverage with source links and plain-language context.",
    href: "/supreme-court",
  },
  {
    label: "Government litigation",
    title: "Track consequential cases involving public institutions.",
    detail: "Neutral, source-backed records organized around verified court activity.",
    href: "/government-litigation",
  },
  {
    label: "Legal procedure",
    title: "Understand what happens next in a case.",
    detail: "Fifth-grade-level explanations of motions, jurisdiction, judgments, and appeals.",
    href: "/explainers",
  },
] as const;

const audienceItems = [
  ["Legal professionals", "Move from a fact pattern to relevant authority and the underlying record.", "/search"],
  ["Journalists", "Follow cases, parties, courts, and new developments without losing the source.", "/government-litigation"],
  ["Business researchers", "Investigate companies, people, disputes, and connected litigation.", "/parties"],
  ["The public", "Read court activity in clear language without removing the legal context.", "/explainers"],
] as const;

export const revalidate = 300;

const loadRecentlyUpdated = unstable_cache(
  async () => listRecentlyUpdatedPublicCases(db(), 6),
  ["homepage-recently-updated-cases"],
  { revalidate: 300, tags: ["public-cases"] },
);

function formatActivityDate(value: string) {
  return formatEasternDate(value);
}

export default async function HomePage() {
  const recentlyUpdated = await loadRecentlyUpdated();

  return (
    <main>
      <section className="homeHero">
        <div className="shell heroGrid">
          <div className="heroCopy">
            <p className="eyebrow"><span aria-hidden="true" /> Public legal intelligence</p>
            <h1>Understand <span className="brandHeadlineEnd">litigation<span className="signatureDot" aria-hidden="true">.</span></span></h1>
            <p className="lede">
              Search the public record. See where a case stands. Understand what happened,
              who is involved, and what may come next.
            </p>
            <form action="/cases" role="search" className="searchBox">
              <label htmlFor="q">Search published cases by case name, party, or docket number</label>
              <div>
                <input id="q" name="q" type="search" placeholder="Enter a case name, party, or docket number" />
                <button type="submit">Search Jurvio</button>
              </div>
              <p className="searchHint">Public-source results with readable context and links back to the record.</p>
            </form>
          </div>
          <aside className="heroBrief" aria-label="Jurvio research briefing">
            <p className="briefKicker">Research briefing</p>
            <h2>The record, organized around the questions people actually ask.</h2>
            <dl>
              <div><dt>What happened?</dt><dd>Key events and decisions</dd></div>
              <div><dt>Where does it stand?</dt><dd>Current status and verification time</dd></div>
              <div><dt>Who is involved?</dt><dd>Parties, counsel, judges, and courts</dd></div>
              <div><dt>What does it mean?</dt><dd>Neutral procedure and term explanations</dd></div>
            </dl>
            <Link href="/cases">Browse the public case library <span aria-hidden="true">→</span></Link>
          </aside>
        </div>
      </section>

      <section className="evidenceBar" aria-label="Platform commitments">
        <div className="shell evidenceGrid">
          <div><strong>Source-backed</strong><span>Every explanation stays connected to the public record.</span></div>
          <div><strong>Current status</strong><span>Court events determine status, not editorial guesswork.</span></div>
          <div><strong>Readable HTML</strong><span>Legal material structured for people, search, and accessibility.</span></div>
          <div><strong>Neutral by design</strong><span>Context without advocacy, predictions presented as fact, or legal advice.</span></div>
        </div>
      </section>

      <section className="startingPaths shell" aria-labelledby="starting-paths-title">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Choose your starting point</p>
            <h2 id="starting-paths-title">What do you want to find out?</h2>
          </div>
        </div>
        <div className="startingPathsGrid">
          {startingPaths.map((item, index) => (
            <Link className="startingPathCard" href={item.href} key={item.label}>
              <span aria-hidden="true">0{index + 1}</span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
              <b>{item.action} <span aria-hidden="true">→</span></b>
            </Link>
          ))}
        </div>
      </section>

      <section className="homeSection shell" aria-labelledby="browse-title">
        <div className="sectionHeading">
          <div><p className="eyebrow">Research the legal system</p><h2 id="browse-title">Start with any entity. Follow every connection.</h2></div>
          <Link href="/search">Advanced search →</Link>
        </div>
        <div className="browseGrid">
          {browseItems.map(([title, description, href, number]) => (
            <Link className="browseCard" href={href} key={title}>
              <span className="browseNumber" aria-hidden="true">{number}</span>
              <span><strong>{title}</strong><small>{description}</small></span>
              <b aria-hidden="true">↗</b>
            </Link>
          ))}
        </div>
      </section>

      {recentlyUpdated.length > 0 ? (
        <section className="recentBand" aria-labelledby="recently-updated-title">
          <div className="shell">
            <div className="sectionHeading">
              <div>
                <p className="eyebrow">Live from the public record</p>
                <h2 id="recently-updated-title">Recently updated cases</h2>
              </div>
              <Link href="/cases">Browse every published case →</Link>
            </div>
            <div className="recentCaseGrid">
              {recentlyUpdated.map((legalCase) => (
                <article className="recentCaseCard" key={legalCase.publicId}>
                  <div>
                    <span>{legalCase.courtName}</span>
                    <time dateTime={legalCase.activityDate}>
                      Updated {formatActivityDate(legalCase.activityDate)}
                    </time>
                  </div>
                  <h3>
                    <Link href={`/case/${legalCase.publicId}` as Route}>
                      <BrandedCaseCaption caption={legalCase.caption} />
                    </Link>
                  </h3>
                  <p>Docket {legalCase.docketNumber}</p>
                  <footer>
                    <span>{legalCase.hasPublicDocument ? "Readable opinion available" : "Verified case record"}</span>
                    <Link href={`/case/${legalCase.publicId}` as Route}>Open case →</Link>
                  </footer>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="activityBand">
        <div className="shell">
          <div className="sectionHeading inverse">
            <div><p className="eyebrow light">What Jurvio is following</p><h2>Important litigation should not require a law degree to follow.</h2></div>
            <Link href="/government-litigation">View public-interest tracker →</Link>
          </div>
          <div className="activityGrid">
            {activityItems.map((item) => (
              <article key={item.label}>
                <p>{item.label}</p>
                <h3>{item.title}</h3>
                <span>{item.detail}</span>
                <Link href={item.href}>Explore <span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="homeSection shell">
        <div className="editorialSplit">
          <div>
            <p className="eyebrow">Readable by design</p>
            <h2>Court records tell you what was filed. Jurvio helps you understand the record.</h2>
            <p>
              Opinions, judgments, filings, parties, timelines, and citations belong in one
              connected research experience, with unfamiliar terms explained in place.
            </p>
            <div className="editorialLinks">
              <Link href="/explainers">Browse legal explainers →</Link>
              <Link href="/cases">Explore cases →</Link>
            </div>
          </div>
          <ol className="productProof">
            <li><span>01</span><div><strong>See the current status first</strong><p>Know where the case stands and which verified event changed it.</p></div></li>
            <li><span>02</span><div><strong>Read the important material</strong><p>Navigate opinions and filings as useful web pages instead of an undifferentiated PDF pile.</p></div></li>
            <li><span>03</span><div><strong>Understand procedure in context</strong><p>Clarify jurisdiction, motions, dispositions, appeals, and legal terminology.</p></div></li>
            <li><span>04</span><div><strong>Trace every relationship</strong><p>Move among cases, parties, attorneys, firms, judges, courts, authorities, and statutes.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="audienceBand">
        <div className="shell">
          <div className="sectionHeading">
            <div><p className="eyebrow">Built for serious research</p><h2>One public record. Different questions.</h2></div>
          </div>
          <div className="audienceGrid">
            {audienceItems.map(([title, description, href]) => (
              <Link href={href} key={title}>
                <strong>{title}</strong>
                <span>{description}</span>
                <b aria-hidden="true">Learn more →</b>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="trustSection shell">
        <div>
          <p className="eyebrow">Trust the process</p>
          <h2>Public legal intelligence requires visible standards.</h2>
        </div>
        <div className="trustLinks">
          <Link href={"/coverage" as Route}><strong>Coverage</strong><span>What Jurvio includes, where it comes from, and how recently it was updated.</span></Link>
          <Link href={"/methodology" as Route}><strong>Methodology</strong><span>How records are normalized, connected, explained, and verified.</span></Link>
          <Link href={"/editorial-standards" as Route}><strong>Editorial standards</strong><span>Neutrality, sourcing, corrections, attribution, and responsible automation.</span></Link>
          <Link href={"/public-records-policy" as Route}><strong>Public-records policy</strong><span>Publication, privacy, correction, and redaction principles.</span></Link>
        </div>
      </section>
    </main>
  );
}
