import Link from "next/link";
import type { Route } from "next";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { searchPublicOpinions } from "@/modules/search/application/search-public-opinions";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const results = query.length >= 2 ? await searchPublicOpinions(db(), query) : [];
  if (query.length >= 2) {
    const requestHeaders = await headers();
    await recordDemandEvent(db(), {
      eventType: "internal_search",
      userAgent: requestHeaders.get("user-agent"),
      referrer: requestHeaders.get("referer"),
      path: "/search",
      rawSearchQuery: query,
    });
  }
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
      {query ? (
        <section className="searchResults" aria-live="polite">
          <h2>{results.length ? `${results.length} matching opinions` : "No matching published opinions"}</h2>
          <p className="searchDisclosure">Results come from published court text. Draft or suppressed records never appear.</p>
          {results.map((result) => (
            <article key={result.documentPublicId}>
              <p className="eyebrow">{result.courtName}{result.filedOn ? ` · ${result.filedOn}` : ""}</p>
              <h3><Link href={`/case/${result.casePublicId}/documents/${result.documentPublicId}` as Route}>{result.caseCaption}</Link></h3>
              <p>{result.excerpt.replaceAll(/<[^>]*>/g, "")}</p>
              <small>{result.precedentialStatus ?? "Status not specified"} · cited {result.citationCount} times in source data</small>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
