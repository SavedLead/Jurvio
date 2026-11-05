/**
 * The analytics teaser on the public emergency docket pages. Real headline
 * numbers (with their sample sizes) from the precomputed counts, one small
 * real chart, and locked tiles; Pro users get a plain link instead. Server
 * rendered, no client JS, reads only the cached count tables.
 */
import type { Route } from "next";
import Link from "next/link";
import type { EmergencyStats } from "@/modules/scotus/application/emergency-stats";
import type { ApplicantKind } from "@/modules/scotus/domain/emergency-application";
import { summarize, type Dashboard, type RateCell } from "@/modules/scotus/domain/emergency-stats";
import type { ProGate } from "@/modules/scotus/http/emergency-pro";
import { SignedInSwap } from "./signed-in-swap";
import styles from "./preview.module.css";

const ANALYTICS = "/supreme-court/emergency/analytics" as Route;
const MIN = 5;
const fmt = new Intl.NumberFormat("en-US");

export type PreviewViewer = "signed_out" | "free" | "pro";

export function previewViewer(gate: ProGate): PreviewViewer {
  return gate.ok ? "pro" : gate.reason === "signed_out" ? "signed_out" : "free";
}

const rate = (cell: RateCell | undefined) => cell && cell.decided >= MIN ? Math.round((cell.granted / cell.decided) * 100) : null;

function dashboardOf(stats: EmergencyStats): Dashboard {
  return summarize(stats.stats, stats.votes, { term: null, applicant: null, circuit: null, extensions: false });
}

function yearSpan(stats: EmergencyStats): string {
  const terms = stats.meta.terms.map((row) => row.term);
  return terms.length ? `${Math.min(...terms)}–${Math.max(...terms)} docket years` : "";
}

function Ring({ parts, total, center }: { parts: Array<{ key: string; label: string; value: number; color: string }>; total: number; center: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div className={styles.ring} role="img" aria-label={`${fmt.format(total)} emergency applications: ${parts.map((part) => `${part.label} ${fmt.format(part.value)}`).join(", ")}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="13" />
      {parts.filter((part) => part.value > 0).map((part) => {
        const length = (part.value / (total || 1)) * circumference;
        const dash = <circle key={part.key} cx="50" cy="50" r={radius} fill="none" stroke={part.color} strokeWidth="13"
          strokeDasharray={`${Math.max(0, length - 1.2)} ${circumference}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
        offset += length;
        return dash;
      })}
    </svg>
    <span><strong>{center}</strong><small>granted</small></span>
  </div>;
}

function Lock() {
  return <svg className={styles.lock} width="13" height="15" viewBox="0 0 16 18" aria-hidden="true"><path d="M3 8V5.5a5 5 0 0 1 10 0V8" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="1" y="8" width="14" height="10" rx="2.5" fill="currentColor" /></svg>;
}

function Ctas({ viewer, next }: { viewer: PreviewViewer; next: string }) {
  return <div className={styles.ctas}>
    {viewer === "signed_out"
      ? <Link className={styles.cta} href={`/signin?next=${encodeURIComponent(next)}` as Route} rel="nofollow">Create a free account</Link>
      : <Link className={styles.cta} href={"/pricing?feature=emergency" as Route}>See plans</Link>}
    <Link className={styles.ghost} href={ANALYTICS}>See Pro analytics →</Link>
  </div>;
}

function ProLink({ stats }: { stats: EmergencyStats | null }) {
  return <aside className={styles.proLink} aria-label="Emergency docket analytics">
    <span className={styles.badge}>PRO</span>
    <span><b>Emergency docket analytics</b><small>Grant rates, time to ruling and noted dissents{stats ? `, ${yearSpan(stats)}` : ""}.</small></span>
    <Link href={ANALYTICS}>Open analytics →</Link>
  </aside>;
}

/** Full teaser for the emergency docket list. Signed-in browsers served the cached anonymous page get the plain link. */
export function AnalyticsPreview({ stats, viewer, next = "/supreme-court/emergency" }: { stats: EmergencyStats | null; viewer: PreviewViewer; next?: string }) {
  if (viewer === "pro") return <ProLink stats={stats} />;
  if (!stats) return null;
  if (viewer === "signed_out") return <SignedInSwap anonymous={<Teaser stats={stats} viewer={viewer} next={next} />} signedIn={<ProLink stats={stats} />} />;
  return <Teaser stats={stats} viewer={viewer} next={next} />;
}

function Teaser({ stats, viewer, next }: { stats: EmergencyStats; viewer: PreviewViewer; next: string }) {
  const dashboard = dashboardOf(stats);
  const cells = new Map(dashboard.byApplicant.map((cell) => [cell.key as ApplicantKind, cell]));
  const federal = cells.get("federal");
  const priv = cells.get("private");
  const fedRate = rate(federal);
  const privRate = rate(priv);
  const t = dashboard.totals;
  const mix = [
    { key: "granted", label: "Granted (in whole or part)", value: t.granted + t.grantedInPart, color: "#5b95ff" },
    { key: "denied", label: "Denied", value: t.denied, color: "#c9d3e6" },
    { key: "other", label: "Withdrawn, moot, no ruling", value: t.closedOther, color: "#e9cf9a" },
    { key: "pending", label: "Pending", value: t.pending, color: "#6f86b3" },
  ];
  const loading = stats.meta.terms.filter((row) => !row.complete).length;
  return <section className={styles.preview} aria-labelledby="analytics-preview-title">
    <div className={styles.head}>
      <p className={styles.eyebrow}><span className={styles.badge}>PRO</span> Emergency docket analytics</p>
      <h2 id="analytics-preview-title">Who wins at the emergency docket?</h2>
    </div>
    <div className={styles.body}>
      {fedRate !== null && privRate !== null ? <dl className={styles.findings}>
        <div><dt>Federal government</dt><dd><strong>{fedRate}%</strong> granted</dd><dd className={styles.n}>{fmt.format(federal!.granted)} of {fmt.format(federal!.decided)} decided</dd></div>
        <div><dt>Private parties</dt><dd><strong>{privRate}%</strong> granted</dd><dd className={styles.n}>{fmt.format(priv!.granted)} of {fmt.format(priv!.decided)} decided</dd></div>
      </dl> : null}
      <figure className={styles.chart}>
        <figcaption>How emergency applications end</figcaption>
        <div className={styles.ringWrap}>
          <Ring parts={mix} total={t.applications} center={t.decided >= MIN ? `${Math.round(((t.granted + t.grantedInPart) / t.decided) * 100)}%` : "—"} />
          <ul className={styles.mix}>{mix.map((part) => <li key={part.key}><i style={{ background: part.color }} aria-hidden="true" /><span>{part.label}</span><b>{fmt.format(part.value)}</b></li>)}</ul>
        </div>
      </figure>
      <ul className={styles.locked} aria-label="More in Pro analytics">
        <li><Lock /><span>Median days to ruling</span><b aria-hidden="true">6 days</b><span className={styles.srOnly}>In Pro</span></li>
        <li><Lock /><span>By administration</span><b aria-hidden="true">71%</b><span className={styles.srOnly}>In Pro</span></li>
        <li><Lock /><span>Most noted dissents</span><b aria-hidden="true">Justice ····</b><span className={styles.srOnly}>In Pro</span></li>
      </ul>
    </div>
    <div className={styles.foot}>
      <Ctas viewer={viewer} next={next} />
      <p className={styles.fine}>{fmt.format(t.applications)} emergency applications, {yearSpan(stats)}, routine extensions left out; rates are of decided applications{loading ? "; some docket years are still loading" : ""}. Paid plans are not open yet.</p>
    </div>
  </section>;
}

/** Compact version for an application page: the rate for this applicant type. */
export function AnalyticsPreviewCompact(props: { stats: EmergencyStats | null; viewer: PreviewViewer; applicantKind: ApplicantKind; next: string }) {
  if (!props.stats) return null;
  if (props.viewer === "signed_out") return <SignedInSwap anonymous={<Compact {...props} />} signedIn={<Compact {...props} viewer="pro" />} />;
  return <Compact {...props} />;
}

function Compact({ stats, viewer, applicantKind, next }: { stats: EmergencyStats | null; viewer: PreviewViewer; applicantKind: ApplicantKind; next: string }) {
  if (!stats) return null;
  const dashboard = dashboardOf(stats);
  const cell = dashboard.byApplicant.find((item) => item.key === applicantKind);
  const value = rate(cell);
  return <section className={styles.compact} aria-labelledby="analytics-compact-title">
    <p className={styles.eyebrow}><span className={styles.badge}>PRO</span> Emergency docket analytics</p>
    <h2 id="analytics-compact-title">How often does the Court grant {applicantKind === "federal" ? "the federal government" : applicantKind === "state" ? "states and cities" : "private parties"}?</h2>
    {value !== null ? <p className={styles.compactStat}><strong>{value}%</strong><span>granted in whole or in part<small>{fmt.format(cell!.granted)} of {fmt.format(cell!.decided)} decided, {yearSpan(stats)}</small></span></p> : null}
    {viewer === "pro" ? <Link className={styles.ghost} href={ANALYTICS}>Open analytics →</Link> : <>
      <p className={styles.compactMore}><Lock /> By administration, circuit justice, time to ruling and noted dissents in Pro.</p>
      <Ctas viewer={viewer} next={next} />
    </>}
  </section>;
}
