import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { listPublicJudges } from "@/modules/judges/application/public-judge-analytics";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Federal Judge Analytics",
  description: "Browse source-backed federal judge case volume, outcomes, case mix, timing, awards, and recent decisions on Jurvio.",
  alternates: { canonical: "/judges" },
};

export default async function JudgesPage() {
  const judges = await listPublicJudges(db());
  return <main className={styles.page}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Public legal analytics</p><h1>Federal judges</h1>
      <p>Explore verified case assignments, outcome samples, case mix, ruling timing, monetary awards, and recent public records. Jurvio publishes statistics only when the judge identity and underlying records pass verification checks.</p>
    </header>
    <aside className={styles.notice}>Coverage grows with Jurvio’s federal corpus. Every profile shows its sample size so partial data is never presented as a judge’s complete career record.</aside>
    {judges.length ? <ol className={styles.list}>{judges.map((judge) => <li key={judge.publicId}>
      <Link className={styles.card} href={`/judges/${judge.publicId}` as Route}>
        <h2>{judge.displayName}</h2><p>{judge.courtName ?? "Court unavailable"}</p>
        <dl><div><dt>Public cases</dt><dd>{judge.caseCount.toLocaleString()}</dd></div>
          <div><dt>Outcome sample</dt><dd>{judge.outcomeSample.toLocaleString()}</dd></div></dl>
      </Link>
    </li>)}</ol> : <section className={styles.empty}><h2>No verified judge profiles are published yet</h2>
      <p>Profiles will appear after canonical judge identities, case assignments, and publication decisions pass Jurvio’s source and verification checks.</p></section>}
  </main>;
}
