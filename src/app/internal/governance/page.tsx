import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getGovernanceDashboard, type GovernanceCount } from "@/modules/governance/application/get-governance-dashboard";
import { microusdToUsd, qualityHealth } from "@/modules/governance/domain/governance-health";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "./governance.module.css";

export const dynamic = "force-dynamic";

function MetricList({ rows, empty = "No records." }: { rows: GovernanceCount[]; empty?: string }) {
  if (!rows.length) return <p className={styles.empty}>{empty}</p>;
  return <ul className={styles.metricList}>{rows.map((row) => (
    <li key={row.label}><span>{row.label.replaceAll("_", " ")}</span><strong>{row.value.toLocaleString()}</strong></li>
  ))}</ul>;
}

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "attention" | "safe" }) {
  return <article className={`${styles.stat} ${styles[tone]}`}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></article>;
}

export default async function GovernancePage() {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }

  const dashboard = await getGovernanceDashboard(db());
  const caseHealth = qualityHealth(dashboard.quality.cases);
  const entityHealth = qualityHealth(dashboard.quality.entities);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Internal governance</p>
          <h1>Trust and control center</h1>
          <p>Live operational evidence for publication, data quality, privacy states, demand, agents, and staff actions.</p>
        </div>
        <div className={styles.identity}><span>Signed in</span><strong>{principal.displayName ?? principal.email}</strong><small>{principal.role}</small></div>
      </header>

      <nav className={styles.nav} aria-label="Internal governance navigation">
        <a href="#publication">Publication</a><a href="#quality">Data quality</a><a href="#privacy">Privacy</a>
        <a href="#demand">Demand and cost</a><a href="#agents">Agents</a><a href="#audit">Audit</a>
        <Link href={"/internal/publication" as Route}>Review queue ↗</Link>
        <Link href={"/internal/analytics" as Route}>Demand detail ↗</Link>
      </nav>

      <section className={styles.overview} aria-label="Governance overview">
        <Stat label="Active publication reviews" value={dashboard.publication.activeReviewCount} tone={dashboard.publication.activeReviewCount ? "attention" : "safe"} />
        <Stat label="Open ingestion rejections" value={dashboard.quality.openRejections} tone={dashboard.quality.openRejections ? "attention" : "safe"} />
        <Stat label="Agent actions awaiting execution" value={dashboard.agents.unexecutedActions} tone={dashboard.agents.unexecutedActions ? "attention" : "safe"} />
        <Stat label="Demand events, 30 days" value={dashboard.demand.eventsLast30Days} />
      </section>

      <section id="publication" className={styles.section}>
        <div className={styles.sectionTitle}><div><p>01 · Publication</p><h2>What may appear publicly</h2></div><Link href={"/internal/publication" as Route}>Open review workspace</Link></div>
        <div className={styles.grid3}>
          <article className={styles.panel}><h3>Cases by state</h3><MetricList rows={dashboard.publication.cases} /></article>
          <article className={styles.panel}><h3>Documents by state</h3><MetricList rows={dashboard.publication.documents} /></article>
          <article className={styles.panel}><h3>Review workflow</h3><MetricList rows={dashboard.publication.reviews} empty="No publication reviews have been created." /></article>
        </div>
        <article className={styles.panel}>
          <h3>Recent human decisions</h3>
          {dashboard.publication.recentDecisions.length ? <div className={styles.table}>
            {dashboard.publication.recentDecisions.map((row) => <div key={row.id}><strong>{row.decision.replaceAll("_", " ")}</strong><span>{row.objectType.replaceAll("_", " ")}</span><span>{row.reviewer ?? "system / reviewer unavailable"}</span><time>{new Date(row.occurredAt).toLocaleString()}</time></div>)}
          </div> : <p className={styles.empty}>No completed human publication decisions yet.</p>}
        </article>
      </section>

      <section id="quality" className={styles.section}>
        <div className={styles.sectionTitle}><div><p>02 · Data quality</p><h2>Evidence health and ingestion exceptions</h2></div></div>
        <div className={styles.qualityStrip}>
          <Stat label="Verified cases" value={`${caseHealth.reviewed.toLocaleString()} / ${caseHealth.total.toLocaleString()}`} tone="safe" />
          <Stat label="Cases needing attention" value={caseHealth.attention} tone={caseHealth.attention ? "attention" : "safe"} />
          <Stat label="Verified entities" value={`${entityHealth.reviewed.toLocaleString()} / ${entityHealth.total.toLocaleString()}`} tone="safe" />
          <Stat label="Entities needing attention" value={entityHealth.attention} tone={entityHealth.attention ? "attention" : "safe"} />
        </div>
        <div className={styles.grid4}>
          <article className={styles.panel}><h3>Cases</h3><MetricList rows={dashboard.quality.cases} /></article>
          <article className={styles.panel}><h3>Courts</h3><MetricList rows={dashboard.quality.courts} /></article>
          <article className={styles.panel}><h3>Entities</h3><MetricList rows={dashboard.quality.entities} /></article>
          <article className={styles.panel}><h3>Document extraction</h3><MetricList rows={dashboard.quality.documentConfidence} /></article>
        </div>
        <article className={styles.panel}><h3>Open ingestion rejections</h3>
          {dashboard.quality.recentRejections.length ? <div className={styles.rejections}>{dashboard.quality.recentRejections.map((row) => (
            <div key={row.id}><div><strong>{row.reasonCode.replaceAll("_", " ")}</strong><time>{new Date(row.lastSeenAt).toLocaleString()}</time></div><p>{row.message}</p><small>{row.sourceUri}</small></div>
          ))}</div> : <p className={styles.empty}>No unresolved ingestion rejections.</p>}
        </article>
      </section>

      <section id="privacy" className={styles.section}>
        <div className={styles.sectionTitle}><div><p>03 · Privacy and restrictions</p><h2>Content withheld from public surfaces</h2></div></div>
        <div className={styles.overview}>
          <Stat label="Suppressed cases" value={dashboard.privacy.suppressedCases} />
          <Stat label="Restricted cases" value={dashboard.privacy.restrictedCases} />
          <Stat label="Suppressed documents" value={dashboard.privacy.suppressedDocuments} />
          <Stat label="Restricted documents" value={dashboard.privacy.restrictedDocuments} />
        </div>
        <aside className={styles.disclosure}><strong>Current system boundary</strong><p>These are actual canonical publication states. A dedicated removal/redaction request case-management table and identity-verification workflow do not exist yet, so this dashboard does not claim to show request volume, response time, or requester verification.</p></aside>
      </section>

      <section id="demand" className={styles.section}>
        <div className={styles.sectionTitle}><div><p>04 · Demand and cost</p><h2>What visitors request and what enrichment may cost</h2></div><Link href={"/internal/analytics" as Route}>Open demand intelligence</Link></div>
        <div className={styles.overview}>
          <Stat label="Events, 30 days" value={dashboard.demand.eventsLast30Days} />
          <Stat label="Explanation requests, 30 days" value={dashboard.demand.explanationRequestsLast30Days} />
          <Stat label="Estimated queued enrichment" value={microusdToUsd(dashboard.demand.estimatedQueuedCostMicrousd)} />
          <Stat label="Recorded enrichment cost" value={microusdToUsd(dashboard.demand.actualCostMicrousd)} />
        </div>
        <article className={styles.panel}><h3>Enrichment request states</h3><MetricList rows={dashboard.demand.enrichmentQueue} empty="No enrichment requests have been recorded." /></article>
      </section>

      <section id="agents" className={styles.section}>
        <div className={styles.sectionTitle}><div><p>05 · Agent oversight</p><h2>Automation remains observable and approval-bound</h2></div></div>
        <div className={styles.overview}>
          <Stat label="Enabled definitions" value={dashboard.agents.enabledDefinitions} />
          <Stat label="Tasks awaiting approval" value={dashboard.agents.awaitingApproval} />
          <Stat label="Unexecuted approval-bound actions" value={dashboard.agents.unexecutedActions} />
          <Stat label="Runs, 30 days" value={dashboard.agents.recentRuns.reduce((sum, row) => sum + row.value, 0)} />
        </div>
        <article className={styles.panel}><h3>Agent runs by outcome, 30 days</h3><MetricList rows={dashboard.agents.recentRuns} empty="No agent runs were recorded in this period." /></article>
      </section>

      <section id="audit" className={styles.section}>
        <div className={styles.sectionTitle}><div><p>06 · Audit</p><h2>Recent internal actions</h2></div></div>
        <article className={styles.panel}>
          {dashboard.audit.length ? <div className={styles.table}>{dashboard.audit.map((row) => <div key={row.id}><strong>{row.action.replaceAll("_", " ")}</strong><span>{row.actor ?? "system"}</span><span>{row.targetType ?? "no target"}</span><time>{new Date(row.occurredAt).toLocaleString()}</time></div>)}</div> : <p className={styles.empty}>No internal audit events have been recorded.</p>}
        </article>
      </section>
    </main>
  );
}
