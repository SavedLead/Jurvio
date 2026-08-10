import type { Metadata } from "next";
import { formatEasternDateTime } from "@/lib/time/eastern";
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

/**
 * AUTH-GATED, READ-ONLY court coverage status page.
 *
 * This route is intentionally NOT public: it lives at the cleaner `/heartbeat`
 * URL (instead of `/internal/heartbeat`) but is gated behind the Jurvio
 * command-center session via `requireInternalPrincipal`, exactly like the
 * internal pages. Anonymous visitors get `notFound()`; only an authenticated
 * command-center principal sees the page. It renders ONLY the SELECT-only
 * `getFleetHeartbeat(db())` snapshot and shows public-safe facts: per-court
 * freshness, backlog counts, and a Live / Delayed / Stalled coverage status.
 * It never writes, ingests, or publishes, and it never exposes secrets,
 * credentials, host names, worker IDs, or raw blocker detail strings.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Court coverage status",
  description:
    "Live coverage status for the federal courts Jurvio tracks: last update, last new filing, last publication, backlog, and whether each court is live, delayed, or stalled.",
};

// A court is "Stalled" when its last successful update is missing or older than
// this window (or its source is degraded / repeatedly failing), and "Delayed"
// when it is mildly behind. Thresholds are generous so healthy courts read Live.
const STALL_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const DELAY_THRESHOLD_MS = 60 * 60 * 1000;
const STALL_FAILURES = 3;

function count(value: number) {
  return value.toLocaleString("en-US");
}

function dateTime(value: string | null) {
  return formatEasternDateTime(value, "Not yet");
}

type StatusLabel = "Live" | "Delayed" | "Stalled";
type Status = { label: StatusLabel; tone: string | undefined };

// Derived coverage status. Doubles as the "stalled-worker" indication: a court
// whose source is degraded, has never checked in, is more than two hours stale,
// or is failing repeatedly is treated as Stalled without exposing any worker id.
function coverageStatus(
  healthState: string | null,
  lastCheck: string | null,
  failures: number,
  now: number,
): Status {
  if (healthState === "degraded") return { label: "Stalled", tone: styles.danger };
  if (!lastCheck) return { label: "Stalled", tone: styles.danger };
  const age = now - new Date(lastCheck).getTime();
  if (!Number.isFinite(age) || age > STALL_THRESHOLD_MS) {
    return { label: "Stalled", tone: styles.danger };
  }
  if (failures >= STALL_FAILURES) return { label: "Stalled", tone: styles.danger };
  if (failures > 0 || age > DELAY_THRESHOLD_MS) {
    return { label: "Delayed", tone: styles.warning };
  }
  return { label: "Live", tone: styles.good };
}

// Short, public-safe reason text. Uses the machine blocker *code* (categorised,
// e.g. "pdf unavailable") and counts only; never the raw blocker detail.
function humanizeCode(code: string) {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plural(n: number, one: string, many: string) {
  return `${count(n)} ${n === 1 ? one : many}`;
}

function circuitReason(c: CircuitHeartbeat): string {
  if (c.errors > 0) return plural(c.errors, "retrieval issue", "retrieval issues");
  if (c.blockerCode) {
    const label = humanizeCode(c.blockerCode);
    return c.blockedCount > 1 ? `${label} (${count(c.blockedCount)})` : label;
  }
  if (c.blockedCount > 0) return plural(c.blockedCount, "item on hold", "items on hold");
  if (!c.lastCheck) return "Awaiting first update";
  return "—";
}

function districtReason(d: DistrictHeartbeat): string {
  if (d.errors > 0) return plural(d.errors, "retrieval issue", "retrieval issues");
  if (d.needsReview > 0) return plural(d.needsReview, "awaiting review", "awaiting review");
  if (!d.lastCheck) return "Awaiting first update";
  return "—";
}

const columns = (
  <tr>
    <th>Court</th>
    <th>Source</th>
    <th>Last update</th>
    <th>Last new filing</th>
    <th>Last publication</th>
    <th className={styles.num}>Backlog</th>
    <th>Detail</th>
    <th>Status</th>
  </tr>
);

export default async function CourtCoverageStatusPage() {
  // Gate behind the Jurvio command-center session, mirroring the internal
  // pages. Anonymous visitors get notFound(); only an authenticated principal
  // (viewer / reviewer / administrator) sees any coverage detail.
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }

  const fleet = await getFleetHeartbeat(db());
  const now = Date.now();

  const scotusStatus = coverageStatus(null, fleet.scotus.lastCheck, fleet.scotus.errors, now);

  const totalCourts = 1 + fleet.circuits.length + fleet.districts.length;
  const allStatuses = [
    scotusStatus,
    ...fleet.circuits.map((c) => coverageStatus(c.healthState, c.lastCheck, c.errors, now)),
    ...fleet.districts.map((d) => coverageStatus(d.healthState, d.lastCheck, d.errors, now)),
  ];
  const live = allStatuses.filter((s) => s.label === "Live").length;
  const delayed = allStatuses.filter((s) => s.label === "Delayed").length;
  const stalled = allStatuses.filter((s) => s.label === "Stalled").length;

  const scotusReason = fleet.scotus.backlog > 0
    ? plural(fleet.scotus.backlog, "awaiting review", "awaiting review")
    : fleet.scotus.lastCheck ? "—" : "Awaiting first update";

  const circuitRow = (c: CircuitHeartbeat) => {
    const status = coverageStatus(c.healthState, c.lastCheck, c.errors, now);
    return (
      <tr key={c.courtCode}>
        <td className={styles.wrap}><strong>{c.courtCode.toUpperCase()}</strong><small>{c.courtName}</small></td>
        <td>Official court feed<small>{c.govinfoRecordsDiscovered > 0 ? `${count(c.govinfoRecordsDiscovered)} in public archive` : "Direct feed"}</small></td>
        <td>{dateTime(c.lastCheck)}</td>
        <td>{dateTime(c.lastNewItem)}</td>
        <td>{dateTime(c.lastPublication)}<small>{count(c.publishedCount)} published</small></td>
        <td className={styles.num}>{count(c.backlog)}</td>
        <td className={styles.reason}>{circuitReason(c)}</td>
        <td><span className={status.tone}>{status.label}</span></td>
      </tr>
    );
  };

  const districtRow = (d: DistrictHeartbeat) => {
    const status = coverageStatus(d.healthState, d.lastCheck, d.errors, now);
    return (
      <tr key={d.courtCode}>
        <td className={styles.wrap}><strong>{d.courtCode}</strong><small>{d.courtName}{d.circuit ? ` · Cir. ${d.circuit}` : ""}</small></td>
        <td>{d.rssAvailable ? "Public docket feed" : "Direct feed"}</td>
        <td>{dateTime(d.lastCheck)}</td>
        <td>{dateTime(d.lastNewItem)}</td>
        <td>{dateTime(d.lastPublication)}<small>{count(d.publishedCount)} published</small></td>
        <td className={styles.num}>{count(d.backlog)}</td>
        <td className={styles.reason}>{districtReason(d)}</td>
        <td><span className={status.tone}>{status.label}</span></td>
      </tr>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Court coverage</p>
          <h1>Court coverage status</h1>
          <p className={styles.lede}>A public, read-only view of how fresh Jurvio&apos;s coverage is across the federal courts it tracks: 1 Supreme Court, 13 Courts of Appeals, and 94 District Courts. Each row shows the last update, the last new filing, the last publication, the current backlog, and whether coverage is live, delayed, or stalled.</p>
        </div>
        <div className={styles.asOf}>
          <span>As of</span>
          <strong>{dateTime(fleet.generatedAt)}</strong>
        </div>
      </header>

      <p className={styles.note}>This page is read-only. It reflects a live snapshot of coverage freshness and does not include unpublished drafts, source addresses, or credentials. A court is <strong>Live</strong> when it updated recently, <strong>Delayed</strong> when it is mildly behind, and <strong>Stalled</strong> when its last successful update is missing or more than two hours old.</p>

      <section className={styles.summary} aria-label="Coverage summary">
        <article><span>Courts tracked</span><strong>{count(totalCourts)}</strong></article>
        <article><span>Live</span><strong>{count(live)}</strong></article>
        <article><span>Delayed</span><strong>{count(delayed)}</strong></article>
        <article><span>Stalled</span><strong>{count(stalled)}</strong></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>1 court</p><h2>Supreme Court</h2></div>
          <span className={styles.readOnly}>Read only</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>{columns}</thead>
            <tbody>
              <tr>
                <td className={styles.wrap}><strong>SCOTUS</strong><small>{fleet.scotus.court}</small></td>
                <td>Supreme Court opinions<small>{fleet.scotus.available ? "Official source" : "Not yet available"}</small></td>
                <td>{dateTime(fleet.scotus.lastCheck)}</td>
                <td>{dateTime(fleet.scotus.lastNewItem)}</td>
                <td>{dateTime(fleet.scotus.lastPublication)}<small>{count(fleet.scotus.publishedCases)} published</small></td>
                <td className={styles.num}>{count(fleet.scotus.backlog)}</td>
                <td className={styles.reason}>{scotusReason}</td>
                <td><span className={scotusStatus.tone}>{scotusStatus.label}</span></td>
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
            <thead>{columns}</thead>
            <tbody>{fleet.circuits.length ? fleet.circuits.map(circuitRow) : <tr><td colSpan={8}>Coverage is being prepared.</td></tr>}</tbody>
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
            <thead>{columns}</thead>
            <tbody>{fleet.districts.length ? fleet.districts.map(districtRow) : <tr><td colSpan={8}>Coverage is being prepared.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
