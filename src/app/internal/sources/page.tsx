import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getCourtSourceMatrix, type CourtSourceMatrixRow, type SourceHealth } from "@/modules/operations/application/court-source-matrix";
import styles from "./sources.module.css";

/**
 * Court x source health matrix: every federal court (rows) against every free
 * source (columns). Each cell: available / polled, health, last success, items
 * parsed in the last 24 h and new items stored. Reads court_source and
 * court_fetch_log only (bounded to 35 days). Same internal auth as /internal.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Court sources", robots: { index: false, follow: false } };

const HEALTH_LABEL: Record<SourceHealth, string> = {
  ok: "OK", zero_vs_baseline: "0 vs baseline", failing: "Failing", stale: "Stale", never: "Not run yet", off: "Off",
};

function age(at: string | null, now: number) {
  if (!at) return "never";
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function Cell({ cell, now }: { cell: CourtSourceMatrixRow | undefined; now: number }) {
  if (!cell) return <td className={styles.none}>—</td>;
  if (!cell.available) return <td className={styles.none} title={cell.note ?? ""}>n/a</td>;
  const title = [cell.label, cell.url, cell.note, cell.lastError, cell.lastHttpStatus ? `HTTP ${cell.lastHttpStatus}` : null]
    .filter(Boolean).join("\n");
  return <td className={styles[cell.health]} title={title}>
    <strong>{HEALTH_LABEL[cell.health]}</strong>
    {cell.enabled ? <small>{age(cell.lastSuccessAt, now)} · {cell.items24h} items · {cell.newItems24h} new</small> : <small>{cell.note ?? "not polled"}</small>}
  </td>;
}

export default async function CourtSourcesPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  let matrix: CourtSourceMatrixRow[] = [];
  try { matrix = await getCourtSourceMatrix(db()); } catch { matrix = []; }
  const now = Date.now();
  const sources = [...new Map(matrix.map((cell) => [cell.source, cell.label])).entries()].sort();
  const courts = [...new Set(matrix.map((cell) => cell.courtCode))].sort();
  const byKey = new Map(matrix.map((cell) => [`${cell.courtCode}|${cell.source}`, cell]));
  const counts = matrix.reduce<Record<string, number>>((acc, cell) => { acc[cell.health] = (acc[cell.health] ?? 0) + 1; return acc; }, {});
  return <main className={styles.page}>
    <h1>Court sources</h1>
    <p>{courts.length} courts · {matrix.filter((cell) => cell.enabled).length} polled sources ·
      {" "}{Object.entries(counts).map(([key, value]) => `${HEALTH_LABEL[key as SourceHealth]} ${value}`).join(" · ")}</p>
    {matrix.length === 0 ? <p>The matrix fills after the court-freshness job runs (every 30 minutes).</p> : null}
    <table className={styles.matrix}>
      <thead><tr><th>Court</th>{sources.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
      <tbody>{courts.map((court) => <tr key={court}>
        <th>{court}</th>
        {sources.map(([key]) => <Cell key={key} cell={byKey.get(`${court}|${key}`)} now={now} />)}
      </tr>)}</tbody>
    </table>
  </main>;
}
