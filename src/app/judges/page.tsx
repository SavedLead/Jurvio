import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { JUDGE_DIRECTORY_PAGE_SIZE, listPublicJudgePage } from "@/modules/judges/application/public-judge-analytics";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";

type Params = { page?: string | string[] };

function pageNumber(raw: Params["page"]): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return Math.min(Math.max(Number.parseInt(value ?? "1", 10) || 1, 1), 1000);
}

function pageHref(page: number): Route {
  return (page <= 1 ? "/judges" : `/judges?page=${page}`) as Route;
}

// Counts come from judge_public_stats (refreshed every 30 minutes off the request
// path). A five-minute snapshot of each page keeps crawlers off the database.
const loadJudgePage = unstable_cache(
  async (page: number) => listPublicJudgePage(db(), { page, pageSize: JUDGE_DIRECTORY_PAGE_SIZE }),
  ["public-judge-directory-v2"],
  { revalidate: 300, tags: ["public-judges"] },
);

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const page = pageNumber((await searchParams).page);
  return {
    title: page > 1 ? `Federal Judge Analytics — page ${page}` : "Federal Judge Analytics",
    description: "Browse source-backed federal judge case volume, outcomes, case mix, timing, awards, and recent decisions on Jurvio.",
    alternates: { canonical: page > 1 ? `/judges?page=${page}` : "/judges" },
    // Profiles are listed in the judges sitemap; later directory pages only need to be followed.
    ...(page > 1 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function JudgesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const page = pageNumber((await searchParams).page);
  const { judges, total, pageSize } = await loadJudgePage(page);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return <main className={styles.page}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Public legal analytics</p><h1>Federal judges</h1>
      <p>Explore verified case assignments, outcome samples, case mix, ruling timing, monetary awards, and recent public records. Jurvio publishes statistics only when the judge identity and underlying records pass verification checks.</p>
    </header>
    <aside className={styles.notice}>Coverage grows with Jurvio’s federal corpus. Every profile shows its sample size so partial data is never presented as a judge’s complete career record.</aside>
    {judges.length ? <>
      <p className={styles.resultCount}>Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()} judges, most public cases first.</p>
      <ol className={styles.list} start={first}>{judges.map((judge) => <li key={judge.publicId}>
        <Link className={styles.card} href={`/judges/${judge.publicId}` as Route}>
          <h2>{judge.displayName}</h2><p>{judge.courtName ?? "Court unavailable"}</p>
          <dl><div><dt>Public cases</dt><dd>{judge.caseCount.toLocaleString()}</dd></div>
            <div><dt>Outcome sample</dt><dd>{judge.outcomeSample.toLocaleString()}</dd></div></dl>
        </Link>
      </li>)}</ol>
      {pages > 1 ? <nav className={styles.pagination} aria-label="Judge directory pages">
        {page > 1 ? <Link href={pageHref(page - 1)} rel="prev">← Previous</Link> : <span />}
        <span>Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
        {page < pages ? <Link href={pageHref(page + 1)} rel="next">Next →</Link> : <span />}
      </nav> : null}
    </> : <section className={styles.empty}><h2>{page > 1 ? "No judges on this page" : "No verified judge profiles are published yet"}</h2>
      <p>{page > 1 ? <Link href={pageHref(1)}>Back to the first page</Link> : "Profiles will appear after canonical judge identities, case assignments, and publication decisions pass Jurvio’s source and verification checks."}</p></section>}
  </main>;
}
