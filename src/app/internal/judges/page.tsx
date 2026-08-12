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

  // Authorized judgeships: Article III counts are set by statute (28 U.S.C. §1, §44,
  // §133); bankruptcy judgeships are authorized by the Judicial Conference. "Filled"
  // is judges currently in active commission in our verified roster; senior judges
  // serve additionally and do not occupy an authorized seat, so they are counted
  // separately rather than against the seat total.
  const AUTHORIZED: Record<string, number> = { scotus: 9, appeals: 179, district: 677, bankruptcy: 349 };
  const SEAT_LABEL: Record<string, string> = {
    scotus: "Supreme Court", appeals: "Courts of Appeals", district: "District Courts", bankruptcy: "Bankruptcy Courts",
  };
  const seatRows = (["scotus", "appeals", "district", "bankruptcy"] as const).map((cat) => {
    const inCat = dashboard.judges.filter((j) => (j.category ?? "other") === cat);
    const filled = inCat.filter((j) => j.status === "active").length;
    const senior = inCat.filter((j) => j.status === "senior").length;
    const authorized = AUTHORIZED[cat] ?? 0;
    return { cat, authorized, filled, senior, vacant: Math.max(0, authorized - filled) };
  });
  const seatTotals = seatRows.reduce((a, r) => ({
    authorized: a.authorized + r.authorized, filled: a.filled + r.filled,
    senior: a.senior + r.senior, vacant: a.vacant + r.vacant,
  }), { authorized: 0, filled: 0, senior: 0, vacant: 0 });

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
    <section className={styles.panel}><h2>Seats &amp; vacancies</h2>
      <p className={styles.fresh}>Authorized judgeships are fixed by statute (Article III) and the Judicial Conference (bankruptcy). Filled = judges currently in active commission in the verified roster; vacant = authorized − filled. Senior judges serve additionally and do not occupy an authorized seat. Magistrate positions are authorized per district and are excluded here.</p>
      <div className={styles.table}>
        <table>
          <thead><tr><th>Branch</th><th>Authorized seats</th><th>Filled</th><th>Vacant</th><th>Senior (additional)</th></tr></thead>
          <tbody>
            {seatRows.map((r) => <tr key={r.cat}>
              <td>{SEAT_LABEL[r.cat]}</td>
              <td>{count(r.authorized)}</td>
              <td>{count(r.filled)}</td>
              <td className={r.vacant > 0 ? styles.bad : styles.ok}>{count(r.vacant)}</td>
              <td>{count(r.senior)}</td>
            </tr>)}
            <tr style={{ fontWeight: 700 }}>
              <td>Total</td>
              <td>{count(seatTotals.authorized)}</td>
              <td>{count(seatTotals.filled)}</td>
              <td className={seatTotals.vacant > 0 ? styles.bad : styles.ok}>{count(seatTotals.vacant)}</td>
              <td>{count(seatTotals.senior)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section className={styles.panel}><h2>Every imported federal judge</h2>
      <JudgeRosterTable judges={dashboard.judges} />
    </section>
    <section className={styles.panel}><h2>Detection and repair stream</h2>
      <ol className={styles.repairs}>{dashboard.repairs.map(item => <li key={item.id}><time>{date(item.createdAt)}</time>
        <strong>{item.action.replaceAll("_", " ")}</strong><span>{item.reason}</span><b>{item.outcome}</b></li>)}</ol>
    </section>
  </main>;
}
