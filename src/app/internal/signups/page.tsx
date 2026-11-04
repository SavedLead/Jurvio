import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { formatEasternDateTime } from "@/lib/time/eastern";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getSignupsDashboard } from "@/modules/internal/application/get-signups-dashboard";
import styles from "./signups.module.css";

/** Sign-ups: live account, waitlist, follow and paid counts, plus the latest 50 entries (private: full emails). */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign-ups", robots: { index: false, follow: false } };

const when = (v: string | null) => formatEasternDateTime(v, "—");
const n = (v: number) => new Intl.NumberFormat("en-US").format(v);

export default async function SignupsPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const d = await getSignupsDashboard(db());
  const a = d.accounts;
  const kpis: Array<[string, number, string]> = [
    ["Accounts", a.total, `First ${when(a.first)}`],
    ["Verified", a.verified, `Last ${when(a.last)}`],
    ["Outside people", a.outside, "Excludes jurvio.com, example, cleanyourname"],
    ["New · 24 hours", a.last24h, "Accounts created"],
    ["New · 7 days", a.last7d, "Accounts created"],
    ["Case follows", d.caseFollows.total, `${n(d.caseFollows.users)} users`],
    ["Paid subscriptions", d.paidSubscriptions.reduce((s, r) => s + r.total, 0), "Non-free plans"],
  ];
  return <main className={styles.main}>
    <h1>Sign-ups</h1>
    <p>Live from the production database. Times are Eastern.</p>
    <section className={styles.kpis} aria-label="Sign-up totals">
      {kpis.map(([label, value, meta]) => <article className={styles.kpi} key={label}><span>{label}</span><strong>{n(value)}</strong><p>{meta}</p></article>)}
    </section>

    <section className={styles.section}><h2>Lead waitlist</h2>
      {d.leadWaitlist.length === 0 ? <p className={styles.empty}>No waitlist entries yet.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Source</th><th>Plan</th><th>Total</th><th>Outside</th><th>Converted</th><th>First</th><th>Last</th></tr></thead>
        <tbody>{d.leadWaitlist.map((r) => <tr key={`${r.source}:${r.plan}`}><td>{r.source}</td><td>{r.plan ?? "—"}</td><td>{n(r.total)}</td><td>{n(r.outside)}</td><td>{n(r.converted)}</td><td>{when(r.first)}</td><td>{when(r.last)}</td></tr>)}</tbody>
      </table></div>}
    </section>

    <section className={styles.section}><h2>Plan waitlist</h2>
      {d.planWaitlist.length === 0 ? <p className={styles.empty}>No plan waitlist entries yet.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Plan</th><th>Total</th><th>First</th><th>Last</th></tr></thead>
        <tbody>{d.planWaitlist.map((r) => <tr key={r.plan}><td>{r.plan}</td><td>{n(r.total)}</td><td>{when(r.first)}</td><td>{when(r.last)}</td></tr>)}</tbody>
      </table></div>}
    </section>

    <section className={styles.section}><h2>Paid subscriptions</h2>
      {d.paidSubscriptions.length === 0 ? <p className={styles.empty}>No paid subscriptions yet.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Plan</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>{d.paidSubscriptions.map((r) => <tr key={`${r.plan}:${r.status}`}><td>{r.plan}</td><td>{r.status}</td><td>{n(r.total)}</td></tr>)}</tbody>
      </table></div>}
    </section>

    <section className={styles.section}><h2>Latest 50 accounts and waitlist entries</h2>
      {d.recent.length === 0 ? <p className={styles.empty}>Nothing yet.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Date (ET)</th><th>Type</th><th>Email</th><th>Source</th><th>Plan</th><th>Verified</th></tr></thead>
        <tbody>{d.recent.map((r, i) => <tr key={`${r.kind}:${r.email}:${i}`}><td>{when(r.createdAt)}</td><td>{r.kind}</td><td>{r.email}</td><td>{r.source}</td><td>{r.plan ?? "—"}</td><td>{r.verified == null ? "—" : r.verified ? "yes" : "no"}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
