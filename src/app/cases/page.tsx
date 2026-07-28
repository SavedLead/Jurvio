import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { listPublicCases } from "@/modules/cases/application/list-public-cases";
import styles from "./cases.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Browse public cases",
  description: "Browse verified, published court cases on Jurvio.",
  alternates: { canonical: "/cases" },
};

type Params = { page?: string; court?: string };

function pageHref(page: number, court?: string | null) {
  const params = new URLSearchParams({ page: String(page) });
  if (court) params.set("court", court);
  return `/cases?${params}` as Route;
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const raw = await searchParams;
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1);
  const result = await listPublicCases(db(), {
    page,
    pageSize: 50,
    court: raw.court,
  });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>Public case library</p>
          <h1>Browse verified court cases.</h1>
          <p>
            {result.total.toLocaleString()} source-backed case {result.total === 1 ? "page is" : "pages are"} currently live.
            Opinion text and documents appear separately after extraction and verification.
          </p>
        </div>
      </section>

      <div className={styles.inner}>
        <form className={styles.filters} action="/cases">
          <label htmlFor="court">Court</label>
          <select id="court" name="court" defaultValue={result.court ?? ""}>
            <option value="">All courts</option>
            {result.courts.map((court) => (
              <option key={court.value} value={court.value}>
                {court.label} ({court.count.toLocaleString()})
              </option>
            ))}
          </select>
          <button type="submit">Apply</button>
          {result.court ? <Link href="/cases">Clear</Link> : null}
        </form>

        <div className={styles.resultHead}>
          <h2>{result.total.toLocaleString()} published {result.total === 1 ? "case" : "cases"}</h2>
          <p>Showing newest filed cases first.</p>
        </div>

        {result.cases.length === 0 ? (
          <section className={styles.empty}>
            <h2>No published cases match this court.</h2>
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
                  <Link href={`/case/${legalCase.publicId}` as Route}>{legalCase.caption}</Link>
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
            {result.page > 1 ? <Link href={pageHref(result.page - 1, result.court)}>← Previous</Link> : <span />}
            <span>Page {result.page} of {pages}</span>
            {result.page < pages ? <Link href={pageHref(result.page + 1, result.court)}>Next →</Link> : <span />}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
