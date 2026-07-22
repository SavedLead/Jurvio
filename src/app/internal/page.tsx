import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getExecutiveDashboard } from "@/modules/internal/application/get-executive-dashboard";
import styles from "./internal.module.css";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Still running";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

export default async function InternalOverviewPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }

  const dashboard = await getExecutiveDashboard(db());
  const ingestion = dashboard.latestIngestion;
  const progress = ingestion && ingestion.recordsSeen > 0
    ? Math.min(100, Math.round((ingestion.recordsChanged / ingestion.recordsSeen) * 100))
    : 0;

  const kpis = [
    { label: "Canonical cases", value: dashboard.cases.total, meta: `${formatNumber(dashboard.cases.addedThisWeek)} added in 7 days` },
    { label: "Published cases", value: dashboard.cases.published, meta: `${formatNumber(dashboard.cases.verified)} source-verified` },
    { label: "Legal documents", value: dashboard.content.documents, meta: `${formatNumber(dashboard.content.docketEntries)} docket entries` },
    { label: "Demand events", value: dashboard.demand.events30d, meta: "Last 30 days" },
  ];

  return (
    <main className={styles.main}>
      <div className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Executive overview</p>
          <h1 className={styles.pageTitle}>Jurvio at a glance</h1>
          <p className={styles.pageDescription}>Content growth, publication readiness, audience demand, and operational health in one private workspace.</p>
        </div>
        <time className={styles.timestamp}>Live production data</time>
      </div>

      <section className={styles.kpiGrid} aria-label="Key metrics">
        {kpis.map((kpi) => (
          <article className={styles.card} key={kpi.label}>
            <span className={styles.kpiLabel}>{kpi.label}</span>
            <strong className={styles.kpiValue}>{formatNumber(kpi.value)}</strong>
            <p className={styles.kpiMeta}>{kpi.value === 0 ? "No records yet" : kpi.meta}</p>
          </article>
        ))}
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Operational readiness</h2><Link href={"/internal/publication" as Route}>Review queue →</Link></div>
          <div className={styles.statRows}>
            <div className={styles.statRow}><div className={styles.statLabel}>Publication reviews<span className={styles.statDetail}>Pending or returned for changes</span></div><strong className={`${styles.statValue} ${dashboard.operations.reviewQueue ? styles.attention : styles.good}`}>{formatNumber(dashboard.operations.reviewQueue)}</strong></div>
            <div className={styles.statRow}><div className={styles.statLabel}>Failed ingestion runs<span className={styles.statDetail}>Historical failures requiring inspection</span></div><strong className={`${styles.statValue} ${dashboard.operations.failedIngestionRuns ? styles.attention : styles.good}`}>{formatNumber(dashboard.operations.failedIngestionRuns)}</strong></div>
            <div className={styles.statRow}><div className={styles.statLabel}>Queued enrichments<span className={styles.statDetail}>Demand-triggered explanations and summaries</span></div><strong className={styles.statValue}>{formatNumber(dashboard.operations.queuedEnrichments)}</strong></div>
            <div className={styles.statRow}><div className={styles.statLabel}>Outbox events<span className={styles.statDetail}>Waiting for downstream publication</span></div><strong className={styles.statValue}>{formatNumber(dashboard.operations.unpublishedOutboxEvents)}</strong></div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Latest ingestion</h2></div>
          {ingestion ? <div className={styles.ingestion}>
            <span className={styles.statusPill}>{ingestion.status}</span>
            <h3>{ingestion.provider}</h3>
            <p>{formatNumber(ingestion.recordsSeen)} records inspected · {formatNumber(ingestion.recordsChanged)} changed</p>
            <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: `${progress}%` }} /></div>
            <p>Completed {formatDate(ingestion.completedAt)}</p>
          </div> : <div className={styles.empty}>
            <span className={styles.emptyIcon}>↓</span><h3>No ingestion run yet</h3><p>The first completed or active provider run will appear here automatically.</p>
          </div>}
        </section>
      </div>

      <div className={styles.quickLinks}>
        <Link href={"/internal/analytics" as Route} className={styles.quickLink}><strong>Demand intelligence</strong><span>{formatNumber(dashboard.demand.human30d)} human and {formatNumber(dashboard.demand.machine30d)} machine events in 30 days.</span></Link>
        <Link href={"/internal/publication" as Route} className={styles.quickLink}><strong>Publication control</strong><span>Review source evidence and approve eligible records.</span></Link>
        <span className={styles.quickLink} aria-disabled="true"><strong>Entity intelligence</strong><span>{formatNumber(dashboard.content.entities)} entities across {formatNumber(dashboard.content.courts)} courts. Detailed management coming next.</span></span>
      </div>
    </main>
  );
}
