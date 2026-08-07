import type { Metadata, Route } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { listPublicCourts } from "@/modules/directory/application/public-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 300;

// The court directory aggregates over the full published corpus and changes
// only as slowly as ingestion publishes new cases. Browsers and crawlers reuse
// a five-minute snapshot instead of re-running the GROUP BY on every request.
const listCachedPublicCourts = unstable_cache(
  async () => listPublicCourts(db()),
  ["public-court-directory"],
  { revalidate: 300, tags: ["public-courts"] },
);

export const metadata: Metadata = {
  title: "Courts",
  description: "Browse courts and their source-backed public cases on Jurvio.",
  alternates: { canonical: "/courts" },
};

export default async function CourtsPage() {
  const courts = await listCachedPublicCourts();
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Public legal directory</p><h1>Courts</h1>
    <p>Browse courts represented in Jurvio’s published legal corpus and continue to their available public cases.</p>
  </header>{courts.length ? <ol className={styles.list}>{courts.map((court) => <li key={court.publicId}>
    <Link className={styles.card} href={`/courts/${court.publicId}` as Route}><h2>{court.name}</h2><dl>
      <div><dt>Public cases</dt><dd>{court.caseCount.toLocaleString()}</dd></div>
      {court.jurisdiction ? <div><dt>Jurisdiction</dt><dd>{court.jurisdiction}</dd></div> : null}
    </dl></Link></li>)}</ol> : <section className={styles.empty}><h2>No courts are published yet</h2><p>Courts appear here when at least one related case passes Jurvio’s publication controls.</p></section>}</main>;
}
