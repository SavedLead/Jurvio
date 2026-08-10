import Link from "next/link";
import { formatEasternDateTime } from "@/lib/time/eastern";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import {
  classifySourceHealth,
  formatByteCount,
  getOperationsDashboard,
} from "@/modules/operations/application/get-operations-dashboard";
import styles from "./operations.module.css";

export const dynamic = "force-dynamic";

function count(value: number) {
  return value.toLocaleString("en-US");
}

function dateTime(value: string | null) {
  return formatEasternDateTime(value, "Not available");
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusTone(status: string) {
  if (status === "completed") return styles.good;
  if (status === "running") return styles.active;
  if (status === "completed_with_errors" || status === "failed") return styles.danger;
  return styles.muted;
}

export default async function InternalOperationsPage() {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), [
      "viewer", "reviewer", "administrator",
    ]);
  } catch {
    notFound();
  }

  const dashboard = await getOperationsDashboard(db());
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Internal operations</p>
          <h1>Corpus and ingestion</h1>
          <p className={styles.lede}>A read-only view of Jurvio’s legal corpus, imports, failures, source freshness, and storage pressure.</p>
        </div>
        <div className={styles.identity}>
          <span>{principal.displayName ?? principal.email}</span>
          <small>{principal.role}</small>
        </div>
      </header>

      <nav className={styles.nav} aria-label="Internal sections">
        <strong>Operations</strong>
        <Link href={"/heartbeat" as Route}>Court coverage status</Link>
        <Link href={"/internal/analytics" as Route}>Demand analytics</Link>
        <Link href={"/internal/publication" as Route}>Publication review</Link>
      </nav>

      <section className={styles.kpis} aria-label="Ingestion status">
        <article><span>Running now</span><strong>{count(dashboard.ingestion.running)}</strong></article>
        <article><span>Runs completed · 24h</span><strong>{count(dashboard.ingestion.completedLast24Hours)}</strong></article>
        <article><span>Items imported · 24h</span><strong>{count(dashboard.ingestion.itemsSucceededLast24Hours)}</strong></article>
        <article className={dashboard.ingestion.itemsFailedLast24Hours ? styles.alertCard : undefined}>
          <span>Items failed · 24h</span><strong>{count(dashboard.ingestion.itemsFailedLast24Hours)}</strong>
        </article>
      </section>

      {dashboard.ingestion.oldestRunningStartedAt ? (
        <aside className={styles.notice}>Oldest active run started {dateTime(dashboard.ingestion.oldestRunningStartedAt)}.</aside>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Inventory</p><h2>Corpus</h2></div><time>{dateTime(dashboard.generatedAt)}</time></div>
          <dl className={styles.metricGrid}>
            <div><dt>Cases</dt><dd>{count(dashboard.corpus.cases)}</dd></div>
            <div><dt>Published cases</dt><dd>{count(dashboard.corpus.publishedCases)}</dd></div>
            <div><dt>Courts</dt><dd>{count(dashboard.corpus.courts)}</dd></div>
            <div><dt>Parties</dt><dd>{count(dashboard.corpus.parties)}</dd></div>
            <div><dt>Entities</dt><dd>{count(dashboard.corpus.entities)}</dd></div>
            <div><dt>Docket entries</dt><dd>{count(dashboard.corpus.docketEntries)}</dd></div>
            <div><dt>Documents</dt><dd>{count(dashboard.corpus.documents)}</dd></div>
            <div><dt>Opinions</dt><dd>{count(dashboard.corpus.opinions)}</dd></div>
            <div><dt>Searchable opinions</dt><dd>{count(dashboard.corpus.searchableOpinions)}</dd></div>
            <div><dt>Source artifacts</dt><dd>{count(dashboard.corpus.rawArtifacts)}</dd></div>
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Capacity signals</p><h2>Storage and processing</h2></div></div>
          <dl className={styles.costList}>
            <div><dt>PostgreSQL footprint</dt><dd>{formatByteCount(dashboard.storage.databaseBytes)}</dd></div>
            <div><dt>Recorded source payload</dt><dd>{formatByteCount(dashboard.storage.rawArtifactBytesRecorded)}</dd></div>
            <div><dt>Extracted opinion words</dt><dd>{count(dashboard.storage.documentWords)}</dd></div>
            <div><dt>LLM ingestion spend</dt><dd>$0 by design</dd></div>
          </dl>
          <p className={styles.explanation}>The database footprint is measured directly. Recorded source payload includes only artifacts whose provider metadata contains a content length. Jurvio’s current ingestion path is deterministic and does not call an LLM.</p>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Providers</p><h2>Data-source health</h2></div></div>
        {dashboard.sources.length ? <div className={styles.sourceGrid}>{dashboard.sources.map((source) => {
          const health = classifySourceHealth(source);
          return <article key={source.code}>
            <div className={styles.sourceTitle}><h3>{source.name}</h3><span className={styles[health.tone]}>{health.label}</span></div>
            <dl>
              <div><dt>Latest run</dt><dd>{source.latestRunStatus ? statusLabel(source.latestRunStatus) : "None"}</dd></div>
              <div><dt>Latest artifact</dt><dd>{dateTime(source.latestArtifactAt)}</dd></div>
              <div><dt>Checkpoints</dt><dd>{count(source.checkpointCount)}</dd></div>
            </dl>
            <a href={source.baseUrl} target="_blank" rel="noreferrer">Provider website</a>
          </article>;
        })}</div> : <p>No providers configured.</p>}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>Activity</p><h2>Recent ingestion runs</h2></div>
          <span className={styles.readOnly}>Read only</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Status</th><th>Source and run</th><th>Started</th><th>Selected</th><th>Succeeded</th><th>Failed</th><th>Changed</th></tr></thead>
            <tbody>{dashboard.recentRuns.length ? dashboard.recentRuns.map((run) => (
              <tr key={run.id}>
                <td><span className={statusTone(run.status)}>{statusLabel(run.status)}</span></td>
                <td><strong>{run.provider}</strong><small>{run.runType ?? "unspecified"}<br /><code>{run.id.slice(0, 8)}</code></small></td>
                <td>{dateTime(run.startedAt)}</td><td>{count(run.selectedCount || run.recordsSeen)}</td>
                <td>{count(run.succeededCount)}</td><td>{count(run.failedCount)}</td><td>{count(run.recordsChanged)}</td>
              </tr>
            )) : <tr><td colSpan={7}>No ingestion runs recorded.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Exceptions</p><h2>Recent item failures</h2></div></div>
          {dashboard.recentFailures.length ? <ol className={styles.failureList}>{dashboard.recentFailures.map((failure, index) => (
            <li key={`${failure.runId}-${failure.sourceRecordId}-${index}`}>
              <div><strong>{failure.sourceRecordId}</strong><span>{failure.provider} · {failure.runType ?? "unspecified"}</span></div>
              <p>{failure.errorMessage}</p><time>{dateTime(failure.completedAt)}</time>
            </li>
          ))}</ol> : <p className={styles.empty}>No failed ingestion items recorded.</p>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Controls</p><h2>Job execution</h2></div><span className={styles.readOnly}>Read only</span></div>
          <p className={styles.explanation}>Imports are intentionally not launched from this page yet. Production jobs remain behind audited GitHub workflows or owner-controlled server commands until queueing, rate limits, idempotency, and cancellation are enforced server-side.</p>
          <ul className={styles.guardrails}>
            <li>Current activity and failures are visible here.</li>
            <li>No browser button can accidentally create duplicate imports.</li>
            <li>Administrator job controls can be added after the execution service is durable.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
