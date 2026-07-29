import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  getDemandDashboard,
  type MetricRow,
} from "@/modules/demand/application/get-demand-dashboard";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "./analytics.module.css";

export const dynamic = "force-dynamic";

const windows = [7, 30, 90, 365] as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetricList({
  rows,
  empty = "No activity recorded in this window.",
}: {
  rows: MetricRow[];
  empty?: string;
}) {
  if (!rows.length) return <p className={styles.empty}>{empty}</p>;
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ol className={styles.metricList}>
      {rows.map((row) => (
        <li key={row.label}>
          <div>
            <span>{humanize(row.label)}</span>
            <span
              className={styles.bar}
              style={{ "--bar-width": `${Math.round((row.value / maximum) * 100)}%` } as React.CSSProperties}
            />
          </div>
          <strong>{formatNumber(row.value)}</strong>
        </li>
      ))}
    </ol>
  );
}

export default async function InternalAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  try {
    await requireInternalPrincipal(
      db(), await headers(), ["viewer", "reviewer", "administrator"],
    );
  } catch {
    notFound();
  }

  const requestedDays = Number((await searchParams).days);
  const days = windows.includes(requestedDays as (typeof windows)[number])
    ? requestedDays
    : 30;
  const dashboard = await getDemandDashboard(db(), days);
  const zeroResultRate = dashboard.searchDemand.searches > 0
    ? Math.round((dashboard.searchDemand.zeroResults / dashboard.searchDemand.searches) * 100)
    : 0;
  const periodChange = dashboard.changePercent === null
    ? "No prior-period baseline"
    : `${dashboard.changePercent >= 0 ? "+" : ""}${dashboard.changePercent}% vs preceding ${days} days`;

  return (
    <main className={styles.main}>
      <div className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Demand intelligence</p>
          <h1>What audiences are using</h1>
          <p className={styles.description}>
            Aggregate first-party signals for editorial and corpus planning.
            Counts are events, not unique people, and recommendations never make
            product or publication changes automatically.
          </p>
        </div>
        <nav className={styles.windows} aria-label="Analytics time window">
          {windows.map((windowDays) => (
            <Link
              key={windowDays}
              href={`/internal/analytics?days=${windowDays}` as Route}
              aria-current={windowDays === days ? "page" : undefined}
            >
              {windowDays === 365 ? "1 year" : `${windowDays} days`}
            </Link>
          ))}
        </nav>
      </div>

      <section className={styles.privacyNote}>
        <strong>Privacy-safe aggregate view</strong>
        <span>
          No raw queries, IP addresses, visitor fingerprints, stable visitor IDs,
          session replay, screenshots, or behavioral heatmaps are collected.
        </span>
      </section>

      <section className={styles.kpiGrid} aria-label="Demand overview">
        <article>
          <span>Recorded events</span>
          <strong>{formatNumber(dashboard.totalEvents)}</strong>
          <small>{periodChange}</small>
        </article>
        <article>
          <span>Human activity</span>
          <strong>{formatNumber(dashboard.humanEvents)}</strong>
          <small>Events classified as ordinary browser use</small>
        </article>
        <article>
          <span>Machine retrieval</span>
          <strong>{formatNumber(dashboard.machineEvents)}</strong>
          <small>Search crawlers, retrieval crawlers, agents, and APIs</small>
        </article>
        <article>
          <span>Searches with no result</span>
          <strong>{zeroResultRate}%</strong>
          <small>{formatNumber(dashboard.searchDemand.zeroResults)} of {formatNumber(dashboard.searchDemand.searches)} searches</small>
        </article>
      </section>

      <section className={styles.recommendations}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionNumber}>01 · Review queue</p>
            <h2>Deterministic recommendations</h2>
          </div>
          <span>Advisory only</span>
        </div>
        {dashboard.recommendations.length ? (
          <div className={styles.recommendationGrid}>
            {dashboard.recommendations.map((recommendation) => (
              <article key={recommendation.id}>
                <span className={`${styles.priority} ${styles[recommendation.priority]}`}>
                  {recommendation.priority}
                </span>
                <h3>{recommendation.title}</h3>
                <p>{recommendation.rationale}</p>
                <strong>Suggested review</strong>
                <p>{recommendation.action}</p>
                <details>
                  <summary>Why this appeared</summary>
                  <p>{recommendation.rule}</p>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            No recommendation threshold was reached. Continue collecting
            aggregate signals; no action is required.
          </p>
        )}
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionNumber}>02 · Audience</p><h2>Traffic segments</h2></div>
          </div>
          <MetricList rows={dashboard.byVisitorClass} />
        </section>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionNumber}>03 · Behavior</p><h2>Actions</h2></div>
          </div>
          <MetricList rows={dashboard.byEventType} />
        </section>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionNumber}>04 · Retrieval</p><h2>Crawler and agent families</h2></div>
          </div>
          <MetricList rows={dashboard.topBots} />
        </section>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionNumber}>05 · Pages</p><h2>Most-requested routes</h2></div>
          </div>
          <MetricList rows={dashboard.topPages} />
        </section>
      </div>

      <section className={styles.dimensionSection}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionNumber}>06 · Legal demand</p>
            <h2>Where interest is concentrating</h2>
          </div>
        </div>
        <div className={styles.dimensionGrid}>
          <article><h3>Courts</h3><MetricList rows={dashboard.topCourts} /></article>
          <article><h3>States and jurisdictions</h3><MetricList rows={dashboard.topStates} /></article>
          <article><h3>Case types</h3><MetricList rows={dashboard.topCaseTypes} /></article>
          <article><h3>Topics</h3><MetricList rows={dashboard.topTopics} empty="Topic signals will appear after validated classifications are recorded." /></article>
        </div>
      </section>

      <section className={styles.searchSection}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionNumber}>07 · Search demand</p>
            <h2>What search behavior reveals</h2>
          </div>
          <span>Query shapes only—never query text</span>
        </div>
        <div className={styles.searchGrid}>
          <article>
            <h3>Length buckets</h3>
            <MetricList rows={dashboard.searchDemand.queryLength} />
          </article>
          <article>
            <h3>Token buckets</h3>
            <MetricList rows={dashboard.searchDemand.queryTokens} />
          </article>
          <article className={styles.shapeCard}>
            <div><span>Citation-shaped</span><strong>{formatNumber(dashboard.searchDemand.citationShape)}</strong></div>
            <div><span>Docket-shaped</span><strong>{formatNumber(dashboard.searchDemand.docketShape)}</strong></div>
            <div><span>Boolean syntax</span><strong>{formatNumber(dashboard.searchDemand.booleanSyntax)}</strong></div>
          </article>
        </div>
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionNumber}>08 · Cases</p><h2>Most-requested cases</h2></div>
          </div>
          {dashboard.topCases.length ? (
            <ol className={styles.linkList}>
              {dashboard.topCases.map((row) => (
                <li key={row.publicId}>
                  <Link href={`/case/${row.publicId}` as Route}>{row.label}</Link>
                  <strong>{formatNumber(row.value)}</strong>
                </li>
              ))}
            </ol>
          ) : <p className={styles.empty}>No case activity recorded.</p>}
        </section>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionNumber}>09 · Entities</p><h2>Most-requested entities</h2></div>
          </div>
          {dashboard.topEntities.length ? (
            <ol className={styles.entityList}>
              {dashboard.topEntities.map((row) => (
                <li key={row.publicId}>
                  <div><span>{row.label}</span><small>{humanize(row.entityType)}</small></div>
                  <strong>{formatNumber(row.value)}</strong>
                </li>
              ))}
            </ol>
          ) : <p className={styles.empty}>No entity activity recorded.</p>}
        </section>
      </div>

      <section className={styles.timeline}>
        <div className={styles.sectionHead}>
          <div><p className={styles.sectionNumber}>10 · Time</p><h2>Daily activity by audience</h2></div>
        </div>
        {dashboard.daily.length ? (
          <div className={styles.table} role="table" aria-label="Daily demand events">
            <div role="row" className={styles.tableHead}>
              <span>Date</span><span>Humans</span><span>Search crawlers</span>
              <span>Retrieval crawlers</span><span>Agents + APIs</span>
            </div>
            {dashboard.daily.map((row) => (
              <div role="row" key={row.day}>
                <time>{row.day}</time>
                <span>{formatNumber(row.humans)}</span>
                <span>{formatNumber(row.searchCrawlers)}</span>
                <span>{formatNumber(row.aiCrawlers)}</span>
                <span>{formatNumber(row.agentsAndApis)}</span>
              </div>
            ))}
          </div>
        ) : <p className={styles.empty}>No daily activity recorded.</p>}
      </section>
    </main>
  );
}
