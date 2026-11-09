import type { Metadata, Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { formatEasternDateTime } from "@/lib/time/eastern";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getGrowthDashboard } from "@/modules/growth/get-growth-dashboard";
import styles from "./signups.module.css";

/** Growth: live visitors (non-bot, first touch), funnel, plans, trend and the latest 50 accounts and waitlist entries (private: full emails). */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Growth", robots: { index: false, follow: false } };

const when = (v: string | null) => formatEasternDateTime(v, "—");
const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
const SOURCE_LABEL: Record<string, string> = { google: "Google", bing: "Bing", x: "X", direct: "Direct", other: "Other" };

export default async function GrowthPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const d = await getGrowthDashboard(db());
  const a = d.accounts;
  const paying = d.plans.reduce((s, p) => s + p.paying, 0);
  const kpis: Array<[string, number, string]> = [
    ["Visitors today", d.visitors.today, `${n(d.visitors.sessionsToday)} sessions · ${n(d.visitors.pageViewsToday)} views · ${n(d.visitors.d7)} in 7 days · ${n(d.visitors.d30)} in 30`],
    ["Accounts", a.total, `First ${when(a.first)}`],
    ["Verified", a.verified, `Last ${when(a.last)}`],
    ["Outside people", a.outside, "Excludes jurvio.com, example, cleanyourname"],
    ["New accounts", a.last24h, `24 hours · ${n(a.last7d)} in 7 days`],
    ["Case follows", d.caseFollows.total, `${n(d.caseFollows.users)} users`],
    ["Waitlist", d.leadWaitlist.reduce((s, r) => s + r.total, 0), `${n(d.planWaitlist.reduce((s, r) => s + r.total, 0))} plan waitlist (signed in)`],
    ["Paid subscriptions", paying, "Active plus, pro, team"],
  ];
  const f = d.funnel;
  const steps: Array<[string, number]> = [["Visitors", f.visitors], ["Sign-in requests", f.signinRequests], ["Verified accounts", f.verifiedAccounts],
    ["Accounts with a follow", f.accountsWithFollow], ["Waitlist entries", f.waitlistEntries], ["Paid subscriptions", paying]];
  const top = Math.max(1, ...steps.map((s) => s[1]));
  const peak = Math.max(1, ...d.trend.map((t) => t.visitors + t.accounts + t.waitlist));
  return <main className={styles.main}>
    <h1>Growth</h1>
    <p><Link href="/internal/alert-subscribers">Alert subscribers</Link> shows follow counts only, with no addresses.</p>
    <p>Live from the production database. Visitors are unique browsers confirmed by a JavaScript page-view beacon and classified human (bots, crawlers, headless and scripted clients excluded). Times are Eastern.</p>
    <section className={styles.kpis} aria-label="Growth totals">
      {kpis.map(([label, value, meta]) => <article className={styles.kpi} key={label}><span>{label}</span><strong>{n(value)}</strong><p>{meta}</p></article>)}
    </section>

    <div className={styles.grid2}>
      <section className={styles.section}><h2>Visitors by source</h2>
        <div className={styles.scroll}><table className={styles.table}>
          <thead><tr><th>Source</th><th>Today</th><th>7 days</th><th>30 days</th></tr></thead>
          <tbody>{d.visitors.bySource.map((r) => <tr key={r.source}><td>{SOURCE_LABEL[r.source] ?? r.source}</td><td>{n(r.today)}</td><td>{n(r.d7)}</td><td>{n(r.d30)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section className={styles.section}><h2>Top landing pages · 30 days</h2>
        {d.topLandingPages.length === 0 ? <p className={styles.empty}>No visitors recorded yet.</p> :
        <div className={styles.scroll}><table className={styles.table}>
          <thead><tr><th>Landing page</th><th>Visitors</th></tr></thead>
          <tbody>{d.topLandingPages.map((r) => <tr key={r.path}><td>{r.path}</td><td>{n(r.visitors)}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </div>

    <div className={styles.grid2}>
      <section className={styles.section}><h2>Funnel · 30 days</h2>
        <div className={styles.funnel}>{steps.map(([label, value]) => <div className={styles.funnelRow} key={label}>
          <span>{label}</span><span className={styles.bar}><i style={{ width: `${(value / top) * 100}%` }} /></span><strong>{n(value)}</strong></div>)}</div>
      </section>
      <section className={styles.section}><h2>Accounts by plan</h2>
        <div className={styles.scroll}><table className={styles.table}>
          <thead><tr><th>Plan</th><th>Accounts</th><th>Paying</th></tr></thead>
          <tbody>{d.plans.map((r) => <tr key={r.plan}><td>{r.plan}</td><td>{n(r.total)}</td><td>{r.plan === "free" ? "—" : n(r.paying)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </div>

    <section className={styles.section}><h2>Daily trend · 30 days</h2>
      <div className={styles.trend} role="img" aria-label="Daily visitors and sign-ups for the last 30 days">
        {d.trend.map((t) => <div key={t.day} title={`${t.day}: ${t.visitors} visitors, ${t.signinRequests} sign-in requests, ${t.accounts} accounts, ${t.waitlist} waitlist`}>
          <s style={{ height: `${((t.accounts + t.waitlist) / peak) * 100}%` }} /><b style={{ height: `${(t.visitors / peak) * 100}%` }} /></div>)}
      </div>
      <p className={styles.legend}><i style={{ background: "#084cc8" }} />Visitors<i style={{ background: "#0f9d58" }} />Accounts + waitlist · {d.trend[0]?.day} to {d.trend.at(-1)?.day}</p>
    </section>

    <section className={styles.section}><h2>Server-rendered page views today, by class</h2>
      <p className={styles.legend}>Pages are edge-cached, so server renders skew to crawlers. These are a bot check, not visitors.</p>
      {d.serverPageViewsToday.length === 0 ? <p className={styles.empty}>None today.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Class</th><th>Events</th></tr></thead>
        <tbody>{d.serverPageViewsToday.map((r) => <tr key={r.visitorClass}><td>{r.visitorClass}</td><td>{n(r.events)}</td></tr>)}</tbody>
      </table></div>}
    </section>

    <div className={styles.grid2}>
      <section className={styles.section}><h2>Lead waitlist</h2>
        {d.leadWaitlist.length === 0 ? <p className={styles.empty}>No waitlist entries yet.</p> :
        <div className={styles.scroll}><table className={styles.table}>
          <thead><tr><th>Source</th><th>Plan</th><th>Total</th><th>Outside</th><th>Converted</th></tr></thead>
          <tbody>{d.leadWaitlist.map((r) => <tr key={`${r.source}:${r.plan}`}><td>{r.source}</td><td>{r.plan ?? "—"}</td><td>{n(r.total)}</td><td>{n(r.outside)}</td><td>{n(r.converted)}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className={styles.section}><h2>Plan waitlist</h2>
        {d.planWaitlist.length === 0 ? <p className={styles.empty}>No plan waitlist entries yet.</p> :
        <div className={styles.scroll}><table className={styles.table}>
          <thead><tr><th>Plan</th><th>Total</th></tr></thead>
          <tbody>{d.planWaitlist.map((r) => <tr key={r.plan}><td>{r.plan}</td><td>{n(r.total)}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </div>

    <section className={styles.section}><h2>Latest 50 accounts and waitlist entries</h2>
      {d.recent.length === 0 ? <p className={styles.empty}>Nothing yet.</p> :
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Created (ET)</th><th>Email</th><th>Type</th><th>Plan</th><th>Source</th><th>Landing page</th><th>First followed case</th><th>Last seen (ET)</th></tr></thead>
        <tbody>{d.recent.map((r, i) => <tr key={`${r.kind}:${r.email}:${i}`}>
          <td>{when(r.createdAt)}</td><td>{r.email}</td><td>{r.signupVia}</td><td>{r.plan ?? "—"}</td>
          <td>{r.source ? SOURCE_LABEL[r.source] ?? r.source : "unknown"}</td><td>{r.landingPath ?? "—"}</td>
          <td>{r.firstCasePublicId ? <Link href={`/case/${r.firstCasePublicId}` as Route}>{r.firstCaseCaption ?? r.firstCasePublicId}</Link> : "—"}</td>
          <td>{when(r.lastSeenAt)}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
