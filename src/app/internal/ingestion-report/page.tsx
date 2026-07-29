import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getCaseIngestionReport } from "@/modules/operations/application/get-case-ingestion-report";
import styles from "./report.module.css";

export const dynamic = "force-dynamic";
const labels = {
  A: "What happened and why it matters", B: "Question presented and source",
  C: "Holding and disposition", D: "Justice lineup and vote", E: "Timeline",
  F: "Syllabus and orders", G: "Briefs, transcripts, and audio",
} as const;
const count = (value: number) => value.toLocaleString("en-US");
const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value))
  : "Date unavailable";

export default async function CaseIngestionReportPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch { notFound(); }
  const report = await getCaseIngestionReport(db());
  return <main className={styles.main}>
    <header className={styles.head}>
      <div><p className={styles.eyebrow}>Internal operations</p><h1>Case ingestion report</h1>
        <p>Official SCOTUS intake, publication blockers, next actions, and A–G enrichment coverage. Optional gaps never count as publication blockers.</p></div>
      <time>Generated {date(report.generatedAt)}</time>
    </header>
    <section className={styles.kpis}>
      {[["Official candidates", report.totals.candidates], ["Live cases", report.totals.live],
        ["Ready now", report.totals.ready], ["Blocked candidates", report.totals.blocked]].map(([label, value]) =>
        <article key={String(label)}><span>{label}</span><strong>{count(Number(value))}</strong></article>)}
    </section>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className={styles.eyebrow}>Leverage</p><h2>Publication unlocks</h2></div><span>Independent scenarios</span></div>
      <div className={styles.unlocks}>{report.actions.map((action) =>
        <article key={action.key} className={action.blocking ? undefined : styles.optional}>
          <div><b>{action.blocking ? "Publication blocker" : "Optional only"}</b><h3>{action.label}</h3><p>{action.nextStep}</p></div>
          <aside><strong>{count(action.count)}</strong><span>{action.blocking ? "cases unlocked" : "cases improved"}</span>
            <small>{action.blocking ? `${count(action.projectedLive)} projected live` : "No publication impact"}</small></aside>
        </article>)}</div>
    </section>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className={styles.eyebrow}>Official intake</p><h2>Candidate pipeline</h2></div><span>{report.candidates.length} records</span></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Case</th><th>Status</th><th>Blocker</th><th>Next step</th></tr></thead>
        <tbody>{report.candidates.map((item) => <tr key={item.id}>
          <td><strong>{item.caption}</strong><small>{item.docket} · {date(item.filedOn)}</small></td>
          <td><i className={item.live ? styles.live : styles.held}>{item.live ? "Live" : "Not live"}</i></td>
          <td>{item.blocker ?? "None"}</td><td>{item.nextStep}{item.casePublicId ? <Link href={`/cases/${item.casePublicId}` as Route}>View case</Link> : null}</td>
        </tr>)}</tbody></table></div>
    </section>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className={styles.eyebrow}>P7 coverage</p><h2>Case enrichment matrix</h2></div>
        <details><summary>A–G definitions</summary><dl>{Object.entries(labels).map(([key, label]) => <div key={key}><dt>{key}</dt><dd>{label}</dd></div>)}</dl></details></div>
      <div className={styles.tableWrap}><table className={styles.matrix}><thead><tr><th>Case</th><th>Publication</th>
        {Object.keys(labels).map((key) => <th key={key}>{key}</th>)}<th>Vote</th><th>Next step</th></tr></thead>
        <tbody>{report.cases.map((item) => <tr key={item.id}><td><strong>{item.caption}</strong><small>{item.docket} · {date(item.decidedOn)}</small></td>
          <td><i className={item.live ? styles.live : styles.held}>{item.live ? "Live" : "Not live"}</i></td>
          {Object.entries(item.enrichment).map(([key, complete]) => <td key={key}><i className={complete ? styles.done : styles.gap} title={labels[key as keyof typeof labels]}>{complete ? "✓" : "–"}</i></td>)}
          <td>{item.voteBreakdown ?? "Unavailable"}</td><td>{item.nextStep}<Link href={`/cases/${item.publicId}` as Route}>View case</Link></td></tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
