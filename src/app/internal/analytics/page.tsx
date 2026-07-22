import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getDemandDashboard } from "@/modules/demand/application/get-demand-dashboard";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";

export const dynamic = "force-dynamic";

function MetricList({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (!rows.length) return <p>No activity recorded.</p>;
  return <ol className="metricList">{rows.map((row) => (
    <li key={row.label}><span>{row.label}</span><strong>{row.value.toLocaleString()}</strong></li>
  ))}</ol>;
}

export default async function InternalAnalyticsPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const dashboard = await getDemandDashboard(db(), 30);
  return (
    <main className="shell">
      <p className="eyebrow">Internal demand intelligence</p>
      <h1>What visitors need</h1>
      <p className="lede">Last 30 days, separated by humans, search crawlers, AI systems, and other agents. Raw search queries are not retained.</p>
      <p><Link href="/internal/publication">Publication review</Link></p>
      <section className="analyticsSummary">
        <article><small>Recorded events</small><strong>{dashboard.totalEvents.toLocaleString()}</strong></article>
        <article><small>Human events</small><strong>{(dashboard.byVisitorClass.find((row) => row.label === "human")?.value ?? 0).toLocaleString()}</strong></article>
        <article><small>Machine events</small><strong>{dashboard.byVisitorClass.filter((row) => row.label !== "human" && row.label !== "unknown").reduce((sum, row) => sum + row.value, 0).toLocaleString()}</strong></article>
      </section>
      <div className="analyticsGrid">
        <section><h2>Visitor classes</h2><MetricList rows={dashboard.byVisitorClass} /></section>
        <section><h2>Actions</h2><MetricList rows={dashboard.byEventType} /></section>
        <section><h2>AI and crawler families</h2><MetricList rows={dashboard.topBots} /></section>
        <section><h2>Courts attracting interest</h2><MetricList rows={dashboard.topCourts} /></section>
        <section className="wide"><h2>Most-viewed cases</h2>
          {dashboard.topCases.length ? <ol className="metricList">{dashboard.topCases.map((row) => (
            <li key={row.publicId}><Link href={`/case/${row.publicId}` as Route}>{row.label}</Link><strong>{row.value.toLocaleString()}</strong></li>
          ))}</ol> : <p>No case activity recorded.</p>}
        </section>
        <section className="wide"><h2>Human versus machine activity by day</h2>
          {dashboard.daily.length ? <div className="analyticsTable" role="table">
            {dashboard.daily.map((row) => <div role="row" key={row.day}><time>{row.day}</time><span>Humans {row.humans}</span><span>Machines {row.machines}</span></div>)}
          </div> : <p>No activity recorded.</p>}
        </section>
      </div>
    </main>
  );
}
