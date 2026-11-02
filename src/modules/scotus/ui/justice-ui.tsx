import Link from "next/link";
import type { Route } from "next";
import type { DatasetRelease, JusticeScope } from "@/modules/scotus/application/justice-analytics";
import { percent, termLabel } from "@/modules/scotus/domain/justice-lineup";
import styles from "./justices.module.css";

export const SCDB_DIRECTION_LABEL = "liberal/conservative as coded by the Supreme Court Database";
export const SCDB_HOME = "https://scdb.la.psu.edu/";
export const SCDB_DIRECTION_DOC = "https://scdb.la.psu.edu/online-codebook/decision-direction/";
export const MQ_HOME = "https://mqscores.wustl.edu/";

export function ScopeToggle({ scope, basePath, extra = "" }: { scope: JusticeScope; basePath: string; extra?: string }) {
  const href = (value: JusticeScope) => `${basePath}?scope=${value}${extra}` as Route;
  return <nav className={styles.scope} aria-label="Which decisions to count">
    <span>Count:</span>
    <Link href={href("argued")} aria-current={scope === "argued" ? "page" : undefined}>Argued cases (SCDB decision types 1, 6, 7)</Link>
    <Link href={href("all")} aria-current={scope === "all" ? "page" : undefined}>Every SCDB decision</Link>
  </nav>;
}

export function DirectionExplainer() {
  return <aside className={styles.explain}>
    <h2>What “liberal” and “conservative” mean here</h2>
    <p>These labels are not Jurvio’s opinion and say nothing about party. They are the <strong>{SCDB_DIRECTION_LABEL}</strong> (SCDB), a research dataset maintained by political scientists. SCDB reads each decision and codes its outcome using fixed, published rules. For example, a ruling for a criminal defendant, for a civil-rights claimant, or for free-speech protection is coded “liberal”, and the opposite is coded “conservative”. Some decisions can’t be coded either way; we count those separately and leave them out of the percentage.</p>
    <p>A justice’s vote takes the direction of the side they voted for. <a className={styles.link} href={SCDB_DIRECTION_DOC} rel="noopener">Read SCDB’s coding rules →</a></p>
  </aside>;
}

export function MartinQuinnExplainer() {
  return <aside className={styles.explain}>
    <h2>What a Martin-Quinn score is</h2>
    <p>Martin-Quinn scores are published by political scientists Andrew D. Martin and Kevin M. Quinn. A statistical model places every justice on one left–right line, term by term, using only who voted with whom. <strong>Below zero = more liberal, above zero = more conservative</strong>, relative to the other justices of the era. The shaded band is the model’s 95% credible interval: the score is an estimate, not a measurement. Jurvio shows the published numbers unchanged. <a className={styles.link} href={MQ_HOME} rel="noopener">Martin-Quinn project →</a></p>
  </aside>;
}

export interface LedgerItem { label: string; value: string }

/** The Evidence Ledger: denominators, unknowns, exclusions and sources next to a number. */
export function EvidenceLedger({ items, notes = [], releases, coverage, open = false }: {
  items: LedgerItem[];
  notes?: string[];
  releases: DatasetRelease[];
  coverage?: { label: string; numerator: number; denominator: number } | null;
  open?: boolean;
}) {
  const ratio = coverage && coverage.denominator > 0 ? coverage.numerator / coverage.denominator : null;
  return <details className={styles.ledger} open={open}>
    <summary>Evidence ledger: what was counted and where it came from</summary>
    {items.length ? <dl>{items.map((item) => <div key={item.label} style={{ display: "contents" }}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
    {coverage ? <div className={styles.meter} aria-label={`Coverage: ${coverage.label}`}>
      <span>Coverage</span>
      <div><span style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }} /></div>
      <span>{coverage.numerator.toLocaleString()} of {coverage.denominator.toLocaleString()} {coverage.label} ({percent(ratio)})</span>
    </div> : null}
    {notes.length ? <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    <p style={{ margin: "10px 0 4px", fontWeight: 700 }}>Sources (as published, unchanged)</p>
    <ul>{releases.map((release) => <li key={release.sourceSystem + release.fileName}>
      <a className={styles.link} href={release.sourceUrl} rel="noopener">{releaseName(release)}</a>
      {" "}— {release.fileName}, {release.rowCount.toLocaleString()} rows, SHA-256 {release.sha256.slice(0, 12)}…
      <br /><small>{release.citationText}</small>
    </li>)}</ul>
  </details>;
}

export function releaseName(release: DatasetRelease): string {
  switch (release.sourceSystem) {
    case "scdb_modern": return `Supreme Court Database, ${release.version}`;
    case "scdb_legacy": return `Supreme Court Database (Legacy), ${release.version}`;
    case "martin_quinn": return `Martin-Quinn scores, ${release.version}`;
    case "fjc": return "Federal Judicial Center, Biographical Directory of Article III Federal Judges";
    default: return release.version;
  }
}

export interface SharePoint { term: number; numerator: number; denominator: number; rate: number | null }

const W = 760, H = 260, PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 30;

function xScale(terms: number[]) {
  const min = Math.min(...terms), max = Math.max(...terms);
  const span = Math.max(1, max - min);
  return (term: number) => PAD_L + ((term - min) / span) * (W - PAD_L - PAD_R);
}

function termTicks(terms: number[]): number[] {
  const min = Math.min(...terms), max = Math.max(...terms);
  const step = Math.max(1, Math.ceil((max - min) / 8));
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return ticks;
}

/** SCDB-coded liberal share by term, each point titled with its numerator and denominator. */
export function ShareByTermChart({ points, label }: { points: SharePoint[]; label: string }) {
  const usable = points.filter((point) => point.rate !== null);
  if (!usable.length) return <p className={styles.empty}>No term has a vote with an SCDB direction code in this scope.</p>;
  const x = xScale(points.map((point) => point.term));
  const y = (rate: number) => PAD_T + (1 - rate) * (H - PAD_T - PAD_B);
  const path = usable.map((point, i) => `${i ? "L" : "M"}${x(point.term).toFixed(1)},${y(point.rate!).toFixed(1)}`).join(" ");
  return <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
    <title>{label}</title>
    {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}>
      <line x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} stroke={tick === 0.5 ? "#9aa3b5" : "#eceff5"} strokeDasharray={tick === 0.5 ? "4 4" : undefined} />
      <text x={PAD_L - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#6a7489">{tick * 100}%</text>
    </g>)}
    {termTicks(points.map((point) => point.term)).map((term) => <text key={term} x={x(term)} y={H - 10} textAnchor="middle" fontSize="11" fill="#6a7489">{term}</text>)}
    <path d={path} fill="none" stroke="#3157d5" strokeWidth="2" />
    {usable.map((point) => <circle key={point.term} cx={x(point.term)} cy={y(point.rate!)} r={point.denominator < 20 ? 2.5 : 3.5} fill={point.denominator < 20 ? "#fff" : "#3157d5"} stroke="#3157d5">
      <title>{`${termLabel(point.term)}: ${point.numerator} of ${point.denominator} directional votes coded liberal by SCDB (${percent(point.rate)})`}</title>
    </circle>)}
  </svg>;
}

export interface MqPoint { term: number; mean: number; low: number; high: number }

export function MartinQuinnChart({ points, label }: { points: MqPoint[]; label: string }) {
  if (!points.length) return <p className={styles.empty}>The Martin-Quinn release Jurvio holds has no scores for this justice (scores start with the 1937 term).</p>;
  const x = xScale(points.map((point) => point.term));
  const bound = Math.ceil(Math.max(2, ...points.map((point) => Math.max(Math.abs(point.low), Math.abs(point.high)))));
  const y = (value: number) => PAD_T + ((bound - value) / (2 * bound)) * (H - PAD_T - PAD_B);
  const line = points.map((point, i) => `${i ? "L" : "M"}${x(point.term).toFixed(1)},${y(point.mean).toFixed(1)}`).join(" ");
  const band = `${points.map((point, i) => `${i ? "L" : "M"}${x(point.term).toFixed(1)},${y(point.high).toFixed(1)}`).join(" ")} ${[...points].reverse().map((point) => `L${x(point.term).toFixed(1)},${y(point.low).toFixed(1)}`).join(" ")} Z`;
  const step = bound <= 4 ? 1 : 2;
  const ticks: number[] = [];
  for (let value = -bound; value <= bound; value += step) ticks.push(value);
  return <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
    <title>{label}</title>
    {ticks.map((tick) => <g key={tick}>
      <line x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#9aa3b5" : "#eceff5"} strokeDasharray={tick === 0 ? "4 4" : undefined} />
      <text x={PAD_L - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#6a7489">{tick}</text>
    </g>)}
    <text x={W - PAD_R} y={PAD_T + 12} textAnchor="end" fontSize="11" fill="#9a3412">more conservative ↑</text>
    <text x={W - PAD_R} y={H - PAD_B - 6} textAnchor="end" fontSize="11" fill="#1e40af">more liberal ↓</text>
    {termTicks(points.map((point) => point.term)).map((term) => <text key={term} x={x(term)} y={H - 10} textAnchor="middle" fontSize="11" fill="#6a7489">{term}</text>)}
    <path d={band} fill="#c7d2fe" opacity="0.6" />
    <path d={line} fill="none" stroke="#3730a3" strokeWidth="2" />
    {points.map((point) => <circle key={point.term} cx={x(point.term)} cy={y(point.mean)} r="2.5" fill="#3730a3">
      <title>{`${termLabel(point.term)}: posterior mean ${point.mean.toFixed(3)} (95% interval ${point.low.toFixed(3)} to ${point.high.toFixed(3)})`}</title>
    </circle>)}
  </svg>;
}

export function ShareBar({ rate }: { rate: number | null }) {
  return <div className={styles.bar} role="img" aria-label={`${percent(rate)} coded liberal by SCDB`}>
    <span style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} />
  </div>;
}

/** Blue (agree often) to amber (agree rarely). */
export function agreementColor(rate: number | null): { background: string; color: string } {
  if (rate === null) return { background: "#f1f3f8", color: "#9aa3b5" };
  const t = Math.max(0, Math.min(1, (rate - 0.4) / 0.6));
  const from = [254, 215, 170], to = [49, 87, 213];
  const mix = from.map((value, i) => Math.round(value + (to[i]! - value) * t));
  return { background: `rgb(${mix.join(",")})`, color: t > 0.55 ? "#fff" : "#3b2a12" };
}
