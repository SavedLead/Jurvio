import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { formatEasternDateTime } from "@/lib/time/eastern";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getPulseSnapshot } from "@/modules/operations/application/get-pulse-snapshot";
import type { CircuitHeartbeat, DistrictHeartbeat } from "@/modules/operations/application/get-fleet-heartbeat";
import styles from "./pulse.module.css";

/**
 * AUTH-GATED, READ-ONLY "Pulse" — a single live glance at the whole platform:
 * corpus totals, SCOTUS U.S. Reports volume coverage (including the historical
 * 2-90 backfill closing), the publish backlog, and per-tier court health. Gated
 * behind the command-center session exactly like the other internal pages;
 * anonymous visitors get notFound(). It only reads (SELECT-only snapshot) and
 * never exposes drafts, source addresses, or credentials. All times Eastern.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pulse",
  description: "Live platform pulse: corpus totals, SCOTUS volume coverage, publish backlog, and court health.",
};

const STALL_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const DELAY_THRESHOLD_MS = 60 * 60 * 1000;
const STALL_FAILURES = 3;

function count(value: number) {
  return value.toLocaleString("en-US");
}

function dateTime(value: string | null) {
  return formatEasternDateTime(value, "Not yet");
}

function gigabytes(bytes: number) {
  return `${(bytes / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })} GB`;
}

type StatusLabel = "Live" | "Delayed" | "Stalled";

function coverageStatus(healthState: string | null, lastCheck: string | null, failures: number, now: number): StatusLabel {
  if (healthState === "degraded" || !lastCheck) return "Stalled";
  const age = now - new Date(lastCheck).getTime();
  if (!Number.isFinite(age) || age > STALL_THRESHOLD_MS || failures >= STALL_FAILURES) return "Stalled";
  if (failures > 0 || age > DELAY_THRESHOLD_MS) return "Delayed";
  return "Live";
}

function tierPublished(courts: Array<CircuitHeartbeat | DistrictHeartbeat>) {
  return courts.reduce((sum, court) => sum + court.publishedCount, 0);
}

export default async function PulsePage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }

  const pulse = await getPulseSnapshot(db());
  const { corpus, scotusVolumes, publishing, fleet } = pulse;
  const now = Date.now();

  const statuses: StatusLabel[] = [
    coverageStatus(null, fleet.scotus.lastCheck, fleet.scotus.errors, now),
    ...fleet.circuits.map((c) => coverageStatus(c.healthState, c.lastCheck, c.errors, now)),
    ...fleet.districts.map((d) => coverageStatus(d.healthState, d.lastCheck, d.errors, now)),
  ];
  const live = statuses.filter((s) => s === "Live").length;
  const delayed = statuses.filter((s) => s === "Delayed").length;
  const stalled = statuses.filter((s) => s === "Stalled").length;
  const totalCourts = 1 + fleet.circuits.length + fleet.districts.length;

  const volumeRange = scotusVolumes.minVolume !== null && scotusVolumes.maxVolume !== null
    ? `${scotusVolumes.minVolume}–${scotusVolumes.maxVolume}`
    : "—";
  const circuitPublished = tierPublished(fleet.circuits);
  const districtPublished = tierPublished(fleet.districts);

  return (
    <main className={styles.main}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Optimize &amp; Improve</p>
          <h1 className={styles.pageTitle}>Pulse</h1>
          <p className={styles.lede}>One live glance at the whole platform — refresh any time. All times Eastern.</p>
        </div>
        <div className={styles.asOf}><span>As of</span><strong>{dateTime(pulse.generatedAt)}</strong></div>
      </header>

      <section className={styles.kpiGrid} aria-label="Headline">
        <article className={styles.card}><span className={styles.kpiLabel}>SCOTUS published</span><strong className={styles.kpiValue}>{count(fleet.scotus.publishedCases)}</strong><small>of ~31,000 reported</small></article>
        <article className={styles.card}><span className={styles.kpiLabel}>U.S. Reports volumes</span><strong className={styles.kpiValue}>{volumeRange}</strong><small>{count(scotusVolumes.volumesWithCandidates)} volumes with cases</small></article>
        <article className={styles.card}><span className={styles.kpiLabel}>Cases published</span><strong className={styles.kpiValue}>{count(corpus.published)}</strong><small>{count(corpus.cases)} total in corpus</small></article>
        <article className={styles.card}><span className={styles.kpiLabel}>Readable opinions</span><strong className={styles.kpiValue}>{count(corpus.readableOpinions)}</strong><small>of {count(corpus.opinions)} opinions</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>SCOTUS · U.S. Reports coverage</h2><span className={styles.readOnly}>Read only</span></div>
        <div className={styles.statGrid}>
          <div className={styles.stat}><span>Lowest volume</span><strong>{scotusVolumes.minVolume ?? "—"}</strong><small>{scotusVolumes.minVolume !== null && scotusVolumes.minVolume <= 90 ? "into the nominative era" : "modern only"}</small></div>
          <div className={styles.stat}><span>Highest volume</span><strong>{scotusVolumes.maxVolume ?? "—"}</strong></div>
          <div className={styles.stat}><span>Historical gap (2–90)</span><strong className={scotusVolumes.missingNominative > 0 ? styles.attention : styles.good}>{count(scotusVolumes.missingNominative)}</strong><small>volumes still to ingest</small></div>
          <div className={styles.stat}><span>Modern gap (91–608)</span><strong className={scotusVolumes.missingModern > 0 ? styles.attention : styles.good}>{count(scotusVolumes.missingModern)}</strong><small>volumes still to ingest</small></div>
          <div className={styles.stat}><span>Last ingest</span><strong className={styles.small}>{dateTime(fleet.scotus.lastNewItem)}</strong></div>
          <div className={styles.stat}><span>Last publication</span><strong className={styles.small}>{dateTime(fleet.scotus.lastPublication)}</strong></div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Fleet health · {count(totalCourts)} courts</h2><span className={styles.readOnly}>Read only</span></div>
        <div className={styles.statGrid}>
          <div className={styles.stat}><span>Live</span><strong className={styles.good}>{count(live)}</strong></div>
          <div className={styles.stat}><span>Delayed</span><strong className={delayed > 0 ? styles.attention : undefined}>{count(delayed)}</strong></div>
          <div className={styles.stat}><span>Stalled</span><strong className={stalled > 0 ? styles.danger : styles.good}>{count(stalled)}</strong></div>
          <div className={styles.stat}><span>Circuits published</span><strong>{count(circuitPublished)}</strong><small>{fleet.circuits.length} circuits</small></div>
          <div className={styles.stat}><span>Districts published</span><strong>{count(districtPublished)}</strong><small>{fleet.districts.length} districts</small></div>
          <div className={styles.stat}><span>Needs review</span><strong className={corpus.needsReview > 0 ? styles.attention : styles.good}>{count(corpus.needsReview)}</strong></div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Publishing backlog</h2><span className={styles.readOnly}>Read only</span></div>
        <div className={styles.statGrid}>
          <div className={styles.stat}><span>Outbox unpublished</span><strong className={publishing.outboxUnpublished > 0 ? styles.attention : styles.good}>{count(publishing.outboxUnpublished)}</strong></div>
          <div className={styles.stat}><span>Oldest unpublished</span><strong className={styles.small}>{dateTime(publishing.oldestUnpublished)}</strong></div>
          <div className={styles.stat}><span>SCOTUS approved</span><strong>{count(publishing.scotusApproved)}</strong></div>
          <div className={styles.stat}><span>SCOTUS pending review</span><strong className={publishing.scotusPendingReview > 0 ? styles.attention : styles.good}>{count(publishing.scotusPendingReview)}</strong></div>
          <div className={styles.stat}><span>Documents</span><strong>{count(corpus.documents)}</strong></div>
          <div className={styles.stat}><span>Database size</span><strong>{gigabytes(corpus.databaseBytes)}</strong></div>
        </div>
      </section>
    </main>
  );
}
