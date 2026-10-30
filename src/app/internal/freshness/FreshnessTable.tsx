"use client";

import { useMemo, useState } from "react";
import type { CourtFreshnessSnapshot } from "@/modules/operations/application/court-freshness";
import {
  FRESH_WINDOW_HOURS,
  classifyFreshness,
  filterRows,
  formatAge,
  formatLag,
  isFailing,
  lastUpdatedAt,
  lagHours,
  sortRows,
  summarize,
  type CourtFreshnessRow,
  type CourtType,
  type FreshnessStatus,
  type SortKey,
} from "@/modules/operations/domain/court-freshness";
import styles from "./freshness.module.css";

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const compact = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const filingDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const filingDayYear = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

function exact(value: string | null) {
  return value ? eastern.format(new Date(value)) : "Never";
}
function filingDate(value: string | null, now = Date.now()) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === new Date(now).getUTCFullYear() ? filingDay.format(date) : filingDayYear.format(date);
}

function circuitLabel(circuit: string) {
  if (/^\d+$/.test(circuit)) return String(Number(circuit));
  return circuit.toUpperCase() === "DC" ? "D.C." : circuit;
}

const TYPE_LABEL: Record<CourtType, string> = { supreme: "Supreme Court", appellate: "Courts of Appeals", district: "District Courts" };
const STATUS_LABEL: Record<FreshnessStatus, string> = { fresh: "Fresh", stale: "Stale", never: "Never" };

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean; title?: string }> = [
  { key: "court", label: "Court" },
  { key: "status", label: "Status" },
  { key: "cases", label: "Cases", numeric: true },
  { key: "published", label: "Published", numeric: true },
  { key: "draft", label: "Draft", numeric: true },
  { key: "newestFiling", label: "Newest filing" },
  { key: "feed", label: "Live feed", title: "Official court feed: supremecourt.gov, the circuit's opinion feed, or the district's CM/ECF RSS" },
  { key: "courtlistener", label: "CourtListener", title: "CourtListener date_modified tail" },
  { key: "bulk", label: "Bulk", title: "Last CourtListener bulk snapshot merge that touched this court" },
  { key: "lag", label: "Lag", numeric: true, title: "Time since the most recent update from any source" },
];

function SourceCell({ at, now, note }: { at: string | null; now: number; note?: string | null }) {
  return <td className={at ? styles.sourceCell : `${styles.sourceCell} ${styles.never}`} title={exact(at)}>
    <span>{formatAge(at, now)}</span>{note ? <small>{note}</small> : null}
  </td>;
}

function StatusPill({ row, now }: { row: CourtFreshnessRow; now: number }) {
  const status = classifyFreshness(row, now);
  return <span className={styles.statusStack}>
    <span className={`${styles.pill} ${styles[status]}`}><i aria-hidden="true" />{STATUS_LABEL[status]}</span>
    {isFailing(row) ? <span className={`${styles.pill} ${styles.failing}`} title={`${row.feedFailures} consecutive feed failures`}>Failing</span> : null}
  </span>;
}

export function FreshnessTable({ snapshot, renderedAt }: { snapshot: CourtFreshnessSnapshot; renderedAt: string }) {
  const now = useMemo(() => Date.parse(renderedAt), [renderedAt]);
  const [courtType, setCourtType] = useState<CourtType | "all">("all");
  const [status, setStatus] = useState<FreshnessStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "court", direction: "asc" });

  const summary = useMemo(() => summarize(snapshot.rows, now), [snapshot.rows, now]);
  const visible = useMemo(
    () => sortRows(filterRows(snapshot.rows, { courtType, status, query }, now), sort.key, sort.direction, now),
    [snapshot.rows, courtType, status, query, sort, now],
  );
  const typeCounts = useMemo(() => {
    const counts: Record<CourtType | "all", number> = { all: snapshot.rows.length, supreme: 0, appellate: 0, district: 0 };
    for (const row of snapshot.rows) counts[row.courtType] += 1;
    return counts;
  }, [snapshot.rows]);
  const tail = useMemo(() => {
    const retry = snapshot.sources.filter((source) => source.source === "courtlistener" && source.retryAfterUntil && Date.parse(source.retryAfterUntil) > now);
    return retry.length ? retry.map((source) => source.retryAfterUntil as string).sort().at(-1) ?? null : null;
  }, [snapshot.sources, now]);

  const grouped = sort.key === "court";
  const toggleSort = (key: SortKey) => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: key === "court" ? "asc" : "desc" });

  if (!snapshot.available || snapshot.rows.length === 0) {
    return <main className={styles.page}>
      <Header refreshedAt={null} />
      <section className={styles.emptyState}>
        <h2>{snapshot.available ? "Freshness has not been computed yet" : "Freshness table is not migrated yet"}</h2>
        <p>The core worker lane runs <code>court-freshness</code> one minute after a deploy and every 30 minutes after that. Each feed job also refreshes the courts it touched.</p>
      </section>
    </main>;
  }

  let lastType: CourtType | null = null;
  return <main className={styles.page}>
    <Header refreshedAt={summary.oldestRefreshAt} />

    <section className={styles.summary} aria-label="Summary">
      <article className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Courts tracked</span>
        <strong>{number(summary.courts)}</strong>
        <div className={styles.meter} aria-hidden="true">
          <i className={styles.fresh} style={{ flexGrow: summary.fresh }} />
          <i className={styles.stale} style={{ flexGrow: summary.stale }} />
          <i className={styles.never} style={{ flexGrow: summary.never }} />
        </div>
        <p>{number(typeCounts.supreme)} supreme · {number(typeCounts.appellate)} appellate · {number(typeCounts.district)} district</p>
      </article>
      {(["fresh", "stale", "never"] as const).map((key) => <button
        type="button" key={key}
        className={`${styles.summaryCard} ${styles.summaryButton} ${status === key ? styles.summaryActive : ""}`}
        onClick={() => setStatus(status === key ? "all" : key)}
        aria-pressed={status === key}
      >
        <span className={styles.summaryLabel}><span className={`${styles.dot} ${styles[key]}`} />{STATUS_LABEL[key]}</span>
        <strong>{number(summary[key])}</strong>
        <p>{key === "fresh" ? `Live source within ${FRESH_WINDOW_HOURS}h` : key === "stale" ? "Older, or bulk-only" : "No source has run"}</p>
      </button>)}
      <article className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Cases</span>
        <strong>{compact(summary.cases)}</strong>
        <p>{compact(summary.published)} published · {compact(summary.draft)} draft{summary.withheld ? ` · ${compact(summary.withheld)} withheld` : ""}</p>
      </article>
      <article className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Newest filing</span>
        <strong className={styles.summaryDate}>{filingDate(summary.newestFiledOn)}</strong>
        <p>{summary.failing ? `${number(summary.failing)} feed${summary.failing === 1 ? "" : "s"} failing` : "No failing feeds"}{tail ? ` · CourtListener paused until ${exact(tail)}` : ""}</p>
      </article>
    </section>

    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="tablist" aria-label="Court type">
          {(["all", "supreme", "appellate", "district"] as const).map((key) => <button
            key={key} type="button" role="tab" aria-selected={courtType === key}
            className={courtType === key ? styles.segmentActive : undefined}
            onClick={() => setCourtType(key)}
          >{key === "all" ? "All courts" : TYPE_LABEL[key]}<span>{typeCounts[key]}</span></button>)}
        </div>
        <div className={styles.toolbarRight}>
          <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as FreshnessStatus | "all")}>
            <option value="all">Any status</option>
            <option value="fresh">Fresh</option>
            <option value="stale">Stale</option>
            <option value="never">Never</option>
          </select>
          <input type="search" placeholder="Search court or code" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search courts" />
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr>{COLUMNS.map((column) => {
            const active = sort.key === column.key;
            return <th key={column.key} className={column.numeric ? styles.num : undefined} title={column.title}
              aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => toggleSort(column.key)} className={active ? styles.sortActive : undefined}>
                {column.label}<span aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
              </button>
            </th>;
          })}</tr></thead>
          <tbody>{visible.length ? visible.flatMap((row) => {
            const out = [];
            if (grouped && row.courtType !== lastType) {
              lastType = row.courtType;
              out.push(<tr key={`group-${row.courtType}`} className={styles.groupRow}><th colSpan={COLUMNS.length} scope="colgroup">{TYPE_LABEL[row.courtType]}<span>{typeCounts[row.courtType]}</span></th></tr>);
            }
            const lag = lagHours(row, now);
            out.push(<tr key={row.courtCode}>
              <td className={styles.courtCell}>
                <strong>{row.courtCode.toUpperCase()}</strong>
                <small>{row.name.replace(/^United States /, "").replace(/^(District Court|Court of Appeals) for the /, "")}{row.circuit && row.courtType === "district" ? ` · ${circuitLabel(row.circuit)} Cir.` : ""}</small>
              </td>
              <td><StatusPill row={row} now={now} /></td>
              <td className={styles.num}>{number(row.caseCount)}</td>
              <td className={styles.num}>{number(row.publishedCount)}</td>
              <td className={styles.num}>{number(row.draftCount)}</td>
              <td>{filingDate(row.newestFiledOn, now)}</td>
              <SourceCell at={row.lastFeedAt} now={now} note={!row.feedAvailable ? "no public feed" : row.feedFailures ? `${row.feedFailures} failures` : null} />
              <SourceCell at={row.lastCourtListenerAt} now={now} note={row.courtListenerRetryAfter ? "rate-limited" : null} />
              <SourceCell at={row.lastBulkAt} now={now} />
              <td className={`${styles.num} ${styles.lag}`} title={`Last update from any source: ${exact(lastUpdatedAt(row))}`}>{formatLag(lag)}</td>
            </tr>);
            return out;
          }) : <tr><td colSpan={COLUMNS.length} className={styles.noRows}>No courts match these filters.</td></tr>}</tbody>
        </table>
      </div>
      <p className={styles.footnote}>
        <b>Fresh</b>: the live feed or the CourtListener tail succeeded within {FRESH_WINDOW_HOURS} hours. <b>Stale</b>: older than that, or only bulk snapshots have touched the court. <b>Never</b>: no source has run for it.
        Counts merge every court record with the same court code (CourtListener, official feeds, SCOTUS). Hover any time for the exact Eastern time.
      </p>
    </section>
  </main>;
}

function Header({ refreshedAt }: { refreshedAt: string | null }) {
  return <div className={styles.head}>
    <div>
      <p className={styles.eyebrow}>Ingestion</p>
      <h1>Court freshness</h1>
      <p className={styles.lede}>Every tracked federal court, its corpus, and when each source last reached it.</p>
    </div>
    <div className={styles.refreshed}><span>Computed</span><strong>{refreshedAt ? exact(refreshedAt) : "Not yet"}</strong><small>Refreshes every 30 min and after each feed run</small></div>
  </div>;
}
