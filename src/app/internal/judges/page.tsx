import Link from "next/link";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getJudgeControlCenter } from "@/modules/judges/application/get-judge-control-center";
import JudgeRosterTable from "./JudgeRosterTable";
import styles from "./judges.module.css";

export const dynamic = "force-dynamic";

const count = (value: number) => value.toLocaleString("en-US");
// All timestamps render in Eastern time (ET) per operator preference.
const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value)) + " ET"
  : "Never";

export default async function JudgeControlCenterPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const dashboard = await getJudgeControlCenter(db());
  const s = dashboard.snapshot;
  const healthy = s.roster >= 1_000 && s.services > 0 && s.published >= s.roster;
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p>Judge Autopilot</p><h1>Federal judge control center</h1>
        <span>Live roster, matching, publishing, analytics coverage, faults, and automatic repairs.</span></div>
      <b className={healthy ? styles.good : styles.warn}>{healthy ? "Operating" : "Repairing"}</b>
    </header>
    <nav><Link href={"/internal" as Route}>Command center</Link><Link href={"/internal/operations" as Route}>All operations</Link><a href="/judges" target="_blank">Public judges</a></nav>
    <section className={styles.kpis}>
      <article><span>Verified roster</span><strong>{count(s.roster)}</strong></article>
      <article><span>Active judges</span><strong>{count(s.active)}</strong></article>
      <article><span>Published profiles</span><strong>{count(s.published)}</strong></article>
      <article><span>Case assignments</span><strong>{count(s.assignments)}</strong></article>
      <article><span>Pending matches</span><strong>{count(s.pendingMatches)}</strong></article>
      <article><span>Needs review</span><strong>{count(s.reviewMatches)}</strong></article>
    </section>
    <p className={styles.fresh}>Authoritative roster last received: {date(s.latestRosterAt)}. Dashboard generated {date(dashboard.generatedAt)}.</p>
    <section className={styles.panel}><h2>Every imported federal judge</h2>
      <JudgeRosterTable judges={dashboard.judges} />
    </section>
    <section className={styles.panel}><h2>Detection and repair stream</h2>
      <ol className={styles.repairs}>{dashboard.repairs.map(item => <li key={item.id}><time>{date(item.createdAt)}</time>
        <strong>{item.action.replaceAll("_", " ")}</strong><span>{item.reason}</span><b>{item.outcome}</b></li>)}</ol>
    </section>
  </main>;
}
