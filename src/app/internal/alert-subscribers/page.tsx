import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getAlertSubscriberReport } from "@/modules/accounts/application/alert-subscriber-report";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "../signups/signups.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert subscribers", robots: { index: false, follow: false } };

const n = (value: number) => new Intl.NumberFormat("en-US").format(value);
const TYPE_LABEL: Record<string, string> = {
  case: "Case", judge: "Judge", topic: "Topic", party: "Party", emergency: "SCOTUS emergency docket",
};

export default async function AlertSubscribersPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const report = await getAlertSubscriberReport(db());
  return <main className={styles.main}>
    <h1>Alert subscribers</h1>
    <p>Counts only. Staff and test accounts are excluded. No addresses are shown. <Link href="/internal/signups">Growth</Link></p>
    <section className={styles.kpis} aria-label="Subscriber totals">
      <article className={styles.kpi}><span>Subscribers</span><strong>{n(report.subscribers)}</strong><p>At least one case or other follow</p></article>
      <article className={styles.kpi}><span>Free</span><strong>{n(report.free)}</strong><p>No paying plan</p></article>
      <article className={styles.kpi}><span>Paid</span><strong>{n(report.paid)}</strong><p>Plus, pro, or team</p></article>
    </section>
    <section className={styles.section}><h2>Follows by type</h2>
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Type</th><th>Follows</th><th>Subscribers</th></tr></thead>
        <tbody>{report.follows.map((row) => <tr key={row.followType}><td>{TYPE_LABEL[row.followType] ?? row.followType}</td><td>{n(row.follows)}</td><td>{n(row.subscribers)}</td></tr>)}</tbody>
      </table></div>
    </section>
    <section className={styles.section}><h2>Emergency docket feeds</h2>
      {report.emergencyFeeds.length === 0 ? <p className={styles.empty}>No emergency-docket follows.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Feed</th><th>Follows</th></tr></thead>
        <tbody>{report.emergencyFeeds.map((row) => <tr key={row.feed}><td>{row.feed}</td><td>{n(row.follows)}</td></tr>)}</tbody>
      </table></div>}
    </section>
    <section className={styles.section}><h2>Top followed cases</h2>
      {report.topCases.length === 0 ? <p className={styles.empty}>No case follows.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Case</th><th>Docket</th><th>Follows</th></tr></thead>
        <tbody>{report.topCases.map((row) => <tr key={row.publicId}><td>{row.caption}</td><td>{row.docketNumber}</td><td>{n(row.follows)}</td></tr>)}</tbody>
      </table></div>}
    </section>
    <div className={styles.grid2}>
      {([
        ["Top followed judges", report.topJudges],
        ["Top followed topics", report.topTopics],
        ["Top followed parties", report.topParties],
      ] as const).map(([title, rows]) => <section className={styles.section} key={title}><h2>{title}</h2>
        {rows.length === 0 ? <p className={styles.empty}>None.</p> :
        <div className={styles.scroll}><table className={styles.table}>
          <thead><tr><th>Name</th><th>Follows</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{n(row.follows)}</td></tr>)}</tbody>
        </table></div>}
      </section>)}
    </div>
  </main>;
}
