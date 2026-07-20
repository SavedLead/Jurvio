interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q = "" } = await searchParams;
  return (
    <main className="shell">
      <p className="eyebrow">Jurvio search</p>
      <h1>Search public legal records</h1>
      <form action="/search" role="search" className="searchBox">
        <label htmlFor="q">Case, party, company, attorney, judge, court, or docket number</label>
        <div className="searchRow">
          <input id="q" name="q" defaultValue={q} autoComplete="off" />
          <button type="submit">Search</button>
        </div>
      </form>
      {q ? <p>Search indexing is being connected. Draft records never appear in public results.</p> : null}
    </main>
  );
}
