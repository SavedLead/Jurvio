import type { Metadata, Route } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { listPublicCaseCourts, listPublicCases } from "@/modules/cases/application/list-public-cases";
import { BrandedCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import styles from "./cases.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 300;

const listCachedPublicCases = unstable_cache(
  async (page: number, court: string | null) => listPublicCases(db(), {
    page,
    pageSize: 50,
    court: court ?? undefined,
  }),
  ["public-case-directory"],
  { revalidate: 300, tags: ["public-cases"] },
);
const listCachedPublicCaseCourts = unstable_cache(
  async () => listPublicCaseCourts(db()),
  ["public-case-court-facets"],
  { revalidate: 300, tags: ["public-cases"] },
);

export const metadata: Metadata = {
  title: "Find a court case",
  description: "Search verified, published court cases by case name, party, docket number, or court.",
  alternates: { canonical: "/cases" },
};

type Params = { page?: string; court?: string; q?: string };

function pageHref(page: number, court?: string | null, query?: string | null) {
  const params = new URLSearchParams({ page: String(page) });
  if (court) params.set("court", court);
  if (query) params.set("q", query);
  return `/cases?${params}` as Route;
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const raw = await searchParams;
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1);
  const court = raw.court?.trim() || null;
  const query = raw.q?.trim() || null;
  // Browsing traffic and crawlers reuse a five-minute snapshot. Free-text
  // searches remain live so user-entered queries never pollute the shared cache.
  const [caseResult, courts] = await Promise.all([
    query
      ? listPublicCases(db(), { page, pageSize: 50, court: court ?? undefined, query })
      : listCachedPublicCases(page, court),
    listCachedPublicCaseCourts(),
  ]);
  const result = { ...caseResult, courts };
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const showingSearch = Boolean(result.query);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>Public case library</p>
          <h1>Find a federal court case.</h1>
          <p>
            Search published cases by case name, party, or docket number. Results only include source-backed court records that Jurvio has cleared for public display.
          </p>
        </div>
      </section>

      <div className={styles.inner}>
        <form className={styles.filters} action="/cases">
          <div className={styles.searchField}>
            <label htmlFor="q">Search cases</label>
            <input id="q" name="q" type="search" defaultValue={result.query ?? ""} placeholder="Case name, party, or docket number" />
          </div>
          <div className={styles.courtField}>
            <label htmlFor="court">Court</label>
            <select id="court" name="court" defaultValue={result.court ?? ""}>
              <option value="">All courts</option>
              {result.courts.map((court) => (
                <option key={court.value} value={court.value}>
                  {court.label} ({court.count.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
          <button type="submit">Search</button>
          {(result.court || result.query) ? <Link href="/cases">Clear</Link> : null}
        </form>

        <div className={styles.resultHead}>
          <h2>{result.total.toLocaleString()} {showingSearch ? "matching" : "published"} {result.total === 1 ? "case" : "cases"}</h2>
          <p>{showingSearch ? `Results for “${result.query}”` : "Showing newest filed cases first."}</p>
        </div>

        {result.cases.length === 0 ? (
          <section className={styles.empty}>
            <h2>No public cases match that search yet.</h2>
            <p>Try a different spelling, a shorter party name, or the docket number.</p>
            <Link href="/cases">Browse all public cases</Link>
          </section>
        ) : (
          <div className={styles.list}>
            {result.cases.map((legalCase) => (
              <article key={legalCase.publicId} className={styles.caseCard}>
                <div className={styles.meta}>
                  <span>{legalCase.courtName}</span>
                  {legalCase.filedOn ? <span>Filed {legalCase.filedOn}</span> : null}
                </div>
                <h2>
                  <Link href={`/case/${legalCase.publicId}` as Route}><BrandedCaseCaption caption={legalCase.caption} /></Link>
                </h2>
                <p>Docket {legalCase.docketNumber}</p>
                <div className={styles.status}>
                  <span>Verified court metadata</span>
                  <span>{legalCase.hasPublicDocument ? "Readable opinion available" : "Opinion text processing"}</span>
                </div>
              </article>
            ))}
          </div>
        )}

        {pages > 1 ? (
          <nav className={styles.pagination} aria-label="Case directory pages">
            {result.page > 1 ? <Link href={pageHref(result.page - 1, result.court, result.query)}>← Previous</Link> : <span />}
            <span>Page {result.page} of {pages}</span>
            {result.page < pages ? <Link href={pageHref(result.page + 1, result.court, result.query)}>Next →</Link> : <span />}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
