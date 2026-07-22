import Link from "next/link";

const browseItems = [
  ["Cases", "Search opinions, dockets, filings, and decisions", "/cases"],
  ["Parties", "Understand the people and organizations involved", "/search?q=parties"],
  ["Attorneys", "Find counsel, firms, appearances, and case history", "/search?q=attorneys"],
  ["Judges", "Explore courts, judicial records, and written opinions", "/search?q=judges"],
  ["Courts", "Browse jurisdictions and understand how they work", "/search?q=courts"],
  ["Legal topics", "Follow issues, statutes, doctrines, and procedures", "/search?q=legal+topics"],
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="hero shell">
        <p className="eyebrow"><span aria-hidden="true" /> Public legal intelligence</p>
        <h1>Understand litigation<span className="signatureDot">.</span></h1>
        <p className="lede">
          Search public court records, understand what happened, and discover how every case,
          party, attorney, judge, court, and legal issue connects.
        </p>
        <form action="/search" role="search" className="searchBox">
          <label htmlFor="q">Search cases, people, companies, attorneys, judges, or legal issues</label>
          <div>
            <input id="q" name="q" placeholder="Try a case name, company, person, citation, or question" />
            <button type="submit">Search</button>
          </div>
          <p className="searchHint">Or describe a legal problem in plain English to find relevant opinions.</p>
        </form>
      </section>

      <section className="homeSection shell" aria-labelledby="browse-title">
        <div className="sectionHeading"><div><p className="eyebrow">Explore the legal system</p><h2 id="browse-title">Start anywhere. Follow every connection.</h2></div></div>
        <div className="browseGrid">
          {browseItems.map(([title, description, href]) => (
            <Link className="browseCard" href={href} key={title}>
              <span className="browseIcon" aria-hidden="true">{title.slice(0, 1)}</span>
              <span><strong>{title}</strong><small>{description}</small></span><b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>

      <section className="clarityBand" id="explainers">
        <div className="shell clarityGrid">
          <div><p className="eyebrow light">Built for clarity</p><h2>Court records tell you what was filed. Jurvio tells you what it means.</h2></div>
          <div className="clarityList">
            <article><span>01</span><div><h3>Readable by design</h3><p>Filings and opinions presented as navigable web pages, not piles of PDFs.</p></div></article>
            <article><span>02</span><div><h3>Plain-language explanations</h3><p>Legal terms, procedures, status, and possible next steps explained without commentary.</p></div></article>
            <article><span>03</span><div><h3>Connected to the record</h3><p>Every explanation remains traceable to its source, court event, and verification time.</p></div></article>
          </div>
        </div>
      </section>

      <section className="homeSection shell">
        <div className="sectionHeading"><div><p className="eyebrow">What Jurvio helps you answer</p><h2>Go from a name to the full story.</h2></div><Link href="/cases">Browse all cases →</Link></div>
        <div className="questionGrid">
          <article><p>What is the current status?</p><h3>See where a case stands now.</h3><span>Deterministic status, last verified time, and the event that changed it.</span></article>
          <article><p>What happened and why?</p><h3>Read the important parts first.</h3><span>Key rulings, filings, timelines, and judgments organized around the questions people ask.</span></article>
          <article><p>Who is connected?</p><h3>Follow the people and entities.</h3><span>Parties, attorneys, firms, judges, courts, cited cases, statutes, and related litigation.</span></article>
        </div>
      </section>

      <section className="trustStrip"><div className="shell principles" aria-label="Jurvio principles">
        <article><h2>Readable</h2><p>Plain-language context beside the public court record.</p></article>
        <article><h2>Current</h2><p>Status derived from court events with source and verification time.</p></article>
        <article><h2>Connected</h2><p>Every qualified legal object links to its relationships.</p></article>
        <article><h2>Neutral</h2><p>Source-backed explanation without advocacy or editorial commentary.</p></article>
      </div></section>
    </main>
  );
}
