import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { listPublicJudges } from "@/modules/directory/application/judicial-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Judges in Public Court Records",
  description: "Judge profiles connected to source-backed public court records on Jurvio.",
  alternates: { canonical: "/judges" },
};

export default async function JudgesPage() {
  const judges = await listPublicJudges(db());
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Public legal directory</p><h1>Judges</h1>
    <p>Verified judicial appointments and source-backed public case relationships, presented without ratings or editorial commentary.</p>
  </header>{judges.length ? <ol className={styles.list}>{judges.map((judge) => <li key={judge.publicId}><Link className={styles.card} href={`/judges/${judge.publicId}` as Route}>
    <h2>{judge.displayName}</h2><dl><div><dt>Court</dt><dd>{judge.courtName}</dd></div><div><dt>Published cases</dt><dd>{judge.caseCount.toLocaleString()}</dd></div></dl>
  </Link></li>)}</ol> : <section className={styles.empty}><h2>No qualified judge profiles are published yet</h2><p>A profile appears only after authoritative identity and appointment sources are verified and at least one sourced relationship connects the judge to a published case.</p></section>}</main>;
}
