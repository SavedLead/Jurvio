export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Public legal intelligence</p>
        <h1>Understand litigation.</h1>
        <p className="lede">
          Jurvio connects cases, filings, parties, attorneys, judges, courts, and legal concepts
          with source-backed explanations.
        </p>
        <form action="/search" role="search" className="searchBox">
          <label htmlFor="q">Search opinions by name, citation, legal issue, or plain-English description</label>
          <div>
            <input id="q" name="q" placeholder="Example: employer retaliation after reporting fraud" />
            <button type="submit">Search</button>
          </div>
        </form>
      </section>
      <section className="principles" aria-label="Jurvio principles">
        <article><h2>Readable</h2><p>Plain-language context beside the court record.</p></article>
        <article><h2>Current</h2><p>Deterministic status with source and verification time.</p></article>
        <article><h2>Connected</h2><p>Every qualified legal object links to its relationships.</p></article>
      </section>
    </main>
  );
}
