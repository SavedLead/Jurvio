import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getExecutiveDashboard } from "@/modules/internal/application/get-executive-dashboard";
import styles from "./internal.module.css";

export const dynamic = "force-dynamic";
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value)) : "Still running";

export default async function InternalOverviewPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch { notFound(); }

  const dashboard = await getExecutiveDashboard(db());
  const ingestion = dashboard.latestIngestion;
  const progress = ingestion && ingestion.recordsSeen > 0
    ? Math.min(100, Math.round((ingestion.recordsChanged / ingestion.recordsSeen) * 100)) : 0;
  const capabilities = [
    { id: "ingestion", title: "Ingestion command center", detail: "Corpus, provider runs, source freshness, storage, failures, and active work.", href: "/internal/operations", state: "Live" },
    { id: "publication", title: "Publication X-ray", detail: "Exact case blockers, next actions, projected unlocks, and SCOTUS A–G enrichment.", href: "/internal/ingestion-report", state: "Live" },
    { id: "sources", title: "Court source monitoring", detail: "108-court coverage status: 94 district courts, 13 appellate circuits, the Supreme Court, and per-court live/delayed/stalled health.", href: "/heartbeat", state: "Live" },
    { id: "alerts", title: "Case alerts", detail: "Supported update types, monitorability, subscribers, delivery attempts, and failures.", href: "/internal#alerts", state: "Foundation" },
    { id: "infrastructure", title: "Workers & infrastructure", detail: "Worker runs, failures, leases, scheduler health, processing pressure, and watchdog visibility.", href: "/internal/operations", state: "Read only" },
    { id: "costs", title: "Cost control", detail: "Recorded enrichment cost, storage pressure, demand cost, and approval-bound automation.", href: "/internal/governance#demand", state: "Partial" },
    { id: "analytics", title: "Product analytics", detail: "Human and machine visitors, searches, zero-results, entities, features, and daily demand.", href: "/internal/analytics", state: "Live" },
    { id: "users", title: "Users, plans & access", detail: "Administrator roles are live. Customer plans, subscriptions, limits, and billing follow launch setup.", href: "/internal#users", state: "Admin live" },
    { id: "content", title: "Content & quality control", detail: "Evidence review, publication decisions, data quality, privacy states, and audit history.", href: "/internal/governance", state: "Live" },
    { id: "launch", title: "Launch readiness", detail: "Security, indexing, billing, email, analytics, source coverage, and go-live blockers.", href: "/internal#launch", state: "Tracking" },
  ] as const;

  return <main className={styles.main}>
    <div className={styles.pageHead}>
      <div><p className={styles.eyebrow}>Private operations</p><h1 className={styles.pageTitle}>Jurvio command center</h1>
        <p className={styles.pageDescription}>One production-connected workspace for ingestion, publication, court coverage, alerts, infrastructure, costs, demand, users, quality, and launch readiness.</p></div>
      <time className={styles.timestamp}>Live production data</time>
    </div>

    <section className={styles.kpiGrid} aria-label="Key metrics">
      {[
        ["Canonical cases", dashboard.cases.total, `${number(dashboard.cases.addedThisWeek)} added in 7 days`],
        ["Published cases", dashboard.cases.published, `${number(dashboard.cases.verified)} source-verified`],
        ["Legal documents", dashboard.content.documents, `${number(dashboard.content.docketEntries)} docket entries`],
        ["Demand events", dashboard.demand.events30d, "Last 30 days"],
      ].map(([label, value, meta]) => <article className={styles.card} key={String(label)}>
        <span className={styles.kpiLabel}>{label}</span><strong className={styles.kpiValue}>{number(Number(value))}</strong>
        <p className={styles.kpiMeta}>{Number(value) === 0 ? "No records yet" : meta}</p>
      </article>)}
    </section>

    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Needs attention</h2><Link href={"/internal/governance" as Route}>Open governance →</Link></div>
        <div className={styles.statRows}>
          {[
            ["Publication reviews", "Pending or returned for changes", dashboard.operations.reviewQueue],
            ["Failed ingestion runs", "Historical failures requiring inspection", dashboard.operations.failedIngestionRuns],
            ["Queued enrichments", "Demand-triggered summaries and explanations", dashboard.operations.queuedEnrichments],
            ["Outbox events", "Waiting for downstream publication", dashboard.operations.unpublishedOutboxEvents],
          ].map(([label, detail, value]) => <div className={styles.statRow} key={String(label)}><div className={styles.statLabel}>{label}<span className={styles.statDetail}>{detail}</span></div>
            <strong className={`${styles.statValue} ${Number(value) ? styles.attention : styles.good}`}>{number(Number(value))}</strong></div>)}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Latest ingestion</h2><Link href={"/internal/operations" as Route}>All runs →</Link></div>
        {ingestion ? <div className={styles.ingestion}><span className={styles.statusPill}>{ingestion.status}</span>
          <h3>{ingestion.provider}</h3><p>{number(ingestion.recordsSeen)} records inspected · {number(ingestion.recordsChanged)} changed</p>
          <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: `${progress}%` }} /></div>
          <p>Completed {date(ingestion.completedAt)}</p></div>
          : <div className={styles.empty}><span className={styles.emptyIcon}>↓</span><h3>No ingestion run yet</h3><p>The first active or completed provider run will appear automatically.</p></div>}
      </section>
    </div>

    <section className={styles.capabilitySection} aria-labelledby="capabilities">
      <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>All systems</p><h2 id="capabilities">Command-center coverage</h2></div>
        <span>Truthful status only: unavailable telemetry is never presented as live.</span></div>
      <div className={styles.capabilityGrid}>{capabilities.map((item, index) =>
        <article id={item.id} className={styles.capabilityCard} key={item.id}>
          <div className={styles.capabilityTop}><span>{String(index + 1).padStart(2, "0")}</span><b>{item.state}</b></div>
          <h3>{item.title}</h3><p>{item.detail}</p>
          <Link href={item.href as Route}>Open workspace →</Link>
        </article>)}</div>
    </section>

    <section className={styles.launchPanel}>
      <div><p className={styles.eyebrow}>Launch control</p><h2>Current infrastructure boundary</h2>
        <p>Cloudflare Access, Jurvio role checks, noindex headers, publication controls, and audit evidence are already enforced. Customer billing, outbound alert delivery, and destructive worker controls stay visibly incomplete until their secure backend paths exist.</p></div>
      <div className={styles.launchChecks}>
        <span><i className={styles.check}/>Internal authentication</span>
        <span><i className={styles.check}/>Role-based authorization</span>
        <span><i className={styles.check}/>Sitewide noindex protection</span>
        <span><i className={styles.pending}/>Customer billing setup</span>
        <span><i className={styles.pending}/>Alert delivery provider</span>
        <span><i className={styles.pending}/>Audited worker controls</span>
      </div>
    </section>
  </main>;
}
