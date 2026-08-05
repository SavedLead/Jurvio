import Link from "next/link";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import {
  getFleetHeartbeat,
  type CircuitHeartbeat,
  type DistrictHeartbeat,
} from "@/modules/operations/application/get-fleet-heartbeat";
import styles from "./heartbeat.module.css";

export const dynamic = "force-dynamic";

// A court is considered "stalled" when its source is degraded or has not
// checked in for longer than this generous threshold (or has never checked in).
const STALL_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function count(value: number) {
  return value.toLocaleString("en-US");
}

function dateTime(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

type Liveness = { label: "Live" | "Stalled"; tone: string | undefined };

function liveness(healthState: string | null, lastCheck: string | null, now: number): Liveness {
  if (healthState === "degraded") return { label: "Stalled", tone: styles.danger };
  if (healthState === "unknown" && !lastCheck) return { label: "Stalled", tone: styles.danger };
  if (!lastCheck) return { label: "Stalled", tone: styles.danger };
  const age = now - new Date(lastCheck).getTime();
  if (!Number.isFinite(age) || age > STALL_THRESHOLD_MS) return { label: "Stalled", tone: styles.danger };
  return { label: "Live", tone: styles.good };
}

function healthTone(healthState: string) {
  if (healthState === "healthy") return styles.good;
  if (healthState === "degraded") return styles.danger;
  return styles.muted;
}

export default async function InternalHeartbeatPage() {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), [
      "viewer", "reviewer", "administrator",
    ]);
  } catch {
    notFound();
  }

  const fleet = await getFleetHeartbeat(db());
  const now = Date.now();

  const scotusLive = liveness(null, fleet.scotus.lastCheck, now);
  const circuitStalled = fleet.circuits.filter((c) => liveness(c.healthState, c.lastCheck, now).label === "Stalled").length;
  const districtStalled = fleet.districts.filter((d) => liveness(d.healthState, d.lastCheck, now).label === "Stalled").length;
  const totalCourts = 1 + fleet.circuits.length + fleet.districts.length;
  const totalStalled = (scotusLive.label === "Stalled" ? 1 : 0) + circuitStalled + districtStalled;

  const circuitRow = (c: CircuitHeartbeat) => {
    const live = liveness(c.healthState, c.lastCheck, now);
    return (
      <tr key={c.courtCode}>
        <td className={styles.wrap}><strong>{c.courtCode.toUpperCase()}</strong><small>{c.courtName}</small></td>
        <td><span className={healthTone(c.healthState)}>{c.healthState}</span><small>govinfo: {c.govinfoStatus ?? "n/a"} · {count(c.govinfoRecordsDiscovered)} found</small></td>
        <td>{dateTime(c.lastCheck)}</td>
        <td>{dateTime(c.lastNewItem)}</td>
        <td>{dateTime(c.lastPublication)}<small>{count(c.publishedCount)} published</small></td>
        <td className={styles.num}>{count(c.backlog)}</td>
        <td className={styles.num}><span className={c.errors ? styles.attention : undefined}>{count(c.errors)}</span></td>
        <td><span className={live.tone}>{live.label}</span></td>
      </tr>
    );
  };

  const districtRow = (d: DistrictHeartbeat) => {
    const live = liveness(d.healthState, d.lastCheck, now);
    return (
      <tr key={d.courtCode}>
        <td className={styles.wrap}><strong>{d.courtCode}</strong><small>{d.courtName}{d.circuit ? ` · Cir. ${d.circuit}` : ""}</small></td>
        <td><span className={healthTone(d.healthState)}>{d.healthState}</span><small>{d.rssAvailable ? "RSS" : "no RSS"}</small></td>
        <td>{dateTime(d.lastCheck)}</td>
        <td>{dateTime(d.lastNewItem)}</td>
        <td>{dateTime(d.lastPublication)}<small>{count(d.publishedCount)} published</small></td>
        <td className={styles.num}>{count(d.backlog)}</td>
        <td className={styles.num}><span className={d.errors ? styles.attention : undefined}>{count(d.errors)}</span></td>
        <td><span className={live.tone}>{live.label}</span></td>
      </tr>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Internal operations</p>
          <h1>108-court heartbeat</h1>
          <p className={styles.lede}>A read-only, per-court freshness view of the full federal fleet: 1 Supreme Court, 13 Courts of Appeals, and 94 District Courts. Each row shows the source, its last successful check, the last new item ingested, the last publication, backlog, errors, and whether it is live or stalled.</p>
        </div>
        <div className={styles.identity}>
          <span>{principal.displayName ?? principal.email}</span>
          <small>{principal.role}</small>
        </div>
      </header>

      <nav className={styles.nav} aria-label="Internal sections">
        <Link href={"/internal" as Route}>Command center</Link>
        <Link href={"/internal/operations" as Route}>Operations</Link>
        <strong>Heartbeat</strong>
      </nav>

      <p className={styles.note}>Read only. This page runs SELECT-only queries against production and never writes, ingests, or publishes. A court is marked <strong>Stalled</strong> when its source health is degraded, or its last successful check is unknown, never, or older than two hours; otherwise it is <strong>Live</strong>.</p>

      <section className={styles.summary} aria-label="Fleet summary">
        <article><span>Courts tracked</span><strong>{count(totalCourts)}</strong></article>
        <article><span>Live</span><strong>{count(totalCourts - totalStalled)}</strong></article>
        <article><span>Stalled</span><strong className={totalStalled ? styles.attention : undefined}>{count(totalStalled)}</strong></article>
        <article><span>As of</span><strong style={{ fontSize: "1rem" }}>{dateTime(fleet.generatedAt)}</strong></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>1 court</p><h2>Supreme Court</h2></div>
          <span className={styles.readOnly}>Read only</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Court</th><th>Source / health</th><th>Last check</th><th>Last new item</th><th>Last publication</th><th className={styles.num}>Backlog</th><th className={styles.num}>Errors</th><th>State</th></tr></thead>
            <tbody>
              <tr>
                <td className={styles.wrap}><strong>SCOTUS</strong><small>{fleet.scotus.court}</small></td>
                <td><span className={fleet.scotus.available ? styles.good : styles.muted}>{fleet.scotus.source}</span><small>{fleet.scotus.candidatesByStatus.map((s) => `${s.status}: ${count(s.count)}`).join(" · ") || "no candidates"}</small></td>
                <td>{dateTime(fleet.scotus.lastCheck)}</td>
                <td>{dateTime(fleet.scotus.lastNewItem)}</td>
                <td>{dateTime(fleet.scotus.lastPublication)}<small>{count(fleet.scotus.publishedCases)} published</small></td>
                <td className={styles.num}>{count(fleet.scotus.backlog)}</td>
                <td className={styles.num}><span className={fleet.scotus.errors ? styles.attention : undefined}>{count(fleet.scotus.errors)}</span></td>
                <td><span className={scotusLive.tone}>{scotusLive.label}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>{count(fleet.circuits.length)} circuits</p><h2>Courts of Appeals</h2></div>
          <span className={styles.readOnly}>Read only</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Court</th><th>Source / health</th><th>Last check</th><th>Last new item</th><th>Last publication</th><th className={styles.num}>Backlog</th><th className={styles.num}>Errors</th><th>State</th></tr></thead>
            <tbody>{fleet.circuits.length ? fleet.circuits.map(circuitRow) : <tr><td colSpan={8}>No appellate sources registered.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>{count(fleet.districts.length)} districts</p><h2>District Courts</h2></div>
          <span className={styles.readOnly}>Read only</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Court</th><th>Source / health</th><th>Last check</th><th>Last new item</th><th>Last publication</th><th className={styles.num}>Backlog</th><th className={styles.num}>Errors</th><th>State</th></tr></thead>
            <tbody>{fleet.districts.length ? fleet.districts.map(districtRow) : <tr><td colSpan={8}>No district sources registered.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
