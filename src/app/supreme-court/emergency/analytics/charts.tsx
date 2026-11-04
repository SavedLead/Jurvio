/**
 * Server-rendered charts for the emergency docket analytics page: plain HTML/CSS
 * bars with small inline SVGs (lines, donut, sparklines). No chart library, no
 * client JS beyond the shared tooltip; every chart has a table alternative.
 */
import type { ReactNode } from "react";
import styles from "./analytics.module.css";

export const fmt = new Intl.NumberFormat("en-US");
export function pct(part: number, whole: number, min = 5): string {
  return whole >= min ? `${Math.round((part / whole) * 100)}%` : "—";
}
function share(part: number, whole: number) { return whole ? part / whole : 0; }

/** Round tick values (1, 2, 5 x 10^n apart) covering `value`; ticks as fractions of the axis maximum. */
export function axisTicks(value: number): { max: number; ticks: number[] } {
  const raw = Math.max(1, value) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw && Number.isInteger(candidate)) ?? Math.ceil(raw);
  const max = Math.ceil(Math.max(1, value) / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max + 1e-9; tick += step) ticks.push(tick / max);
  return { max, ticks };
}

export function DataTable({ summary = "View as table", caption, head, rows }: { summary?: string; caption: string; head: string[]; rows: Array<Array<ReactNode>> }) {
  return <details className={styles.dataTable}>
    <summary>{summary}</summary>
    <div className={styles.tableScroll}>
      <table>
        <caption className={styles.srOnly}>{caption}</caption>
        <thead><tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export type Segment = { key: "granted" | "partial" | "denied" | "other" | "pending" | "justice" | "court"; value: number };

export interface Column { id: string; label: string; sublabel?: string; segments: Segment[]; tip: string; selected?: boolean; rate?: number | null; rateLabel?: string }

/** Stacked columns with an optional rate line (0-100%) drawn over them. */
export function StackedColumns({ columns, label, medianAt, medianLabel }: { columns: Column[]; label: string; medianAt?: number | null; medianLabel?: string }) {
  const { max, ticks } = axisTicks(Math.max(1, ...columns.map((column) => column.segments.reduce((sum, segment) => sum + segment.value, 0))));
  const n = columns.length;
  const ratePoints = columns.map((column, index) => column.rate === null || column.rate === undefined ? null : { x: ((index + 0.5) / n) * 100, y: 100 - column.rate, label: column.rateLabel ?? "" });
  const line = ratePoints.filter((point): point is NonNullable<typeof point> => point !== null);
  return <div className={styles.columns} role="img" aria-label={label}>
    <div className={styles.yAxis} aria-hidden="true">{ticks.map((tick) => <span key={tick} style={{ bottom: `${tick * 100}%` }}>{fmt.format(Math.round(max * tick))}</span>)}</div>
    <div className={styles.plot}>
      {ticks.slice(1).map((tick) => <div key={tick} className={styles.gridLine} style={{ bottom: `${tick * 100}%` }} aria-hidden="true" />)}
      <div className={styles.bars}>
        {columns.map((column) => {
          const total = column.segments.reduce((sum, segment) => sum + segment.value, 0);
          return <div key={column.id} className={`${styles.bar} ${column.selected ? styles.barSelected : ""}`} tabIndex={0} data-tip={column.tip} aria-label={column.tip.replace(/\n/g, ". ")}
            style={{ height: `${(total / max) * 100}%` }}>
            {column.segments.filter((segment) => segment.value > 0).map((segment) =>
              <i key={segment.key} className={styles[`seg_${segment.key}`]} style={{ height: `${share(segment.value, total) * 100}%` }} />)}
          </div>;
        })}
      </div>
      {line.length > 1 ? <svg className={styles.overlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={line.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#e3483e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg> : null}
      {line.length ? <div className={styles.pointLayer} aria-hidden="true">
        {line.map((point) => <span key={point.x}><i className={styles.point} style={{ left: `${point.x}%`, top: `${point.y}%` }} />
          <span className={styles.pointLabel} style={{ left: `${point.x}%`, top: `${point.y}%` }}>{point.label}</span></span>)}
      </div> : null}
      {medianAt !== null && medianAt !== undefined ? <div className={styles.medianFlag} style={{ left: `${((medianAt + 0.5) / n) * 100}%` }} aria-hidden="true"><span>{medianLabel}</span></div> : null}
    </div>
    <div className={styles.xAxis} aria-hidden="true" style={{ gridColumn: "1 / 3" }}>
      {columns.map((column) => <span key={column.id}>{column.label}{column.sublabel ? <small>{column.sublabel}</small> : null}</span>)}
    </div>
  </div>;
}

export interface RateItem { key: string; label: string; detail?: string; part: number; whole: number; tip: string }

/** Horizontal bars of a rate (granted / decided), with the overall rate marked. */
export function RateBars({ items, average, min = 5, label }: { items: RateItem[]; average?: number | null; min?: number; label: string }) {
  return <ul className={styles.rates} aria-label={label}>
    {items.map((item) => {
      const enough = item.whole >= min;
      const value = share(item.part, item.whole);
      return <li key={item.key} className={styles.rateRow} tabIndex={0} data-tip={item.tip}>
        <span className={styles.rateLabel}>{item.label}<small>{item.detail ?? `${fmt.format(item.part)} of ${fmt.format(item.whole)} decided`}</small></span>
        <span className={styles.track} aria-hidden="true">
          <span className={`${styles.fill} ${enough ? "" : styles.fillMuted}`} style={{ width: `${(enough ? value : 1) * 100}%` }} />
          {average !== null && average !== undefined ? <span className={styles.avgMark} style={{ left: `calc(${average * 100}% - 1px)` }} /> : null}
        </span>
        <span className={styles.rateValue}>{enough ? `${Math.round(value * 100)}%` : <span className={styles.thin}>n&lt;{min}</span>}<small>n={fmt.format(item.whole)}</small></span>
      </li>;
    })}
  </ul>;
}

export function Donut({ segments, center, centerLabel, label }: { segments: Array<{ key: string; value: number; color: string }>; center: string; centerLabel: string; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div className={styles.donut} role="img" aria-label={label}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="#eef2f8" strokeWidth="13" />
      {segments.filter((segment) => segment.value > 0).map((segment) => {
        const length = (segment.value / total) * circumference;
        const node = <circle key={segment.key} cx="50" cy="50" r={radius} fill="none" stroke={segment.color} strokeWidth="13"
          strokeDasharray={`${Math.max(0, length - 0.8)} ${circumference}`} strokeDashoffset={-offset} />;
        offset += length;
        return node;
      })}
    </svg>
    <div className={styles.donutCenter}><strong>{center}</strong><span>{centerLabel}</span></div>
  </div>;
}

export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const points = values.map((value, index) => value === null ? null : { x: values.length > 1 ? (index / (values.length - 1)) * 100 : 50, y: 28 - (value / 100) * 26 })
    .filter((point): point is { x: number; y: number } => point !== null);
  if (points.length < 2) return null;
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  const last = points.at(-1)!;
  return <svg className={styles.spark} viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
    <polygon points={`0,30 ${path} 100,30`} fill="rgba(124,170,255,.18)" />
    <polyline points={path} fill="none" stroke="#9cc2ff" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    <circle cx={last.x} cy={last.y} r="2.2" fill="#fff" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export function Funnel({ steps, label }: { steps: Array<{ key: string; label: string; value: number; note: string; color: string }>; label: string }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return <ol className={styles.funnel} aria-label={label}>
    {steps.map((step) => <li key={step.key} className={styles.funnelStep} tabIndex={0} data-tip={`${step.label}\n${fmt.format(step.value)} applications · ${step.note}`}
      style={{ width: `${Math.max(64, 64 + (step.value / top) * 36)}%`, background: step.color }}>
      <span>{step.label}<small>{step.note}</small></span><strong>{fmt.format(step.value)}</strong>
    </li>)}
  </ol>;
}

/** Background for a heat cell: white -> coral -> accent -> deep red. */
export function heatColor(value: number, max: number): { background: string; color: string } {
  if (!value) return { background: "#f6f8fb", color: "#b4bccb" };
  const t = Math.min(1, value / Math.max(1, max));
  const stops: Array<[number, [number, number, number]]> = [[0, [251, 211, 207]], [0.4, [240, 138, 128]], [0.7, [227, 72, 62]], [1, [143, 36, 29]]];
  let rgb: [number, number, number] = stops[0]![1];
  for (let index = 1; index < stops.length; index += 1) {
    const [p0, c0] = stops[index - 1]!; const [p1, c1] = stops[index]!;
    if (t <= p1) { const f = (t - p0) / (p1 - p0); rgb = [0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * f)) as [number, number, number]; break; }
  }
  return { background: `rgb(${rgb.join(",")})`, color: t > 0.45 ? "#fff" : "#6b1a14" };
}
