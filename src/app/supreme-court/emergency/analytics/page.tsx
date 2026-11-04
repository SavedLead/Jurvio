import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { robotsFor } from "@/lib/seo/indexing";
import { PLANS, formatMonthlyPrice } from "@/modules/accounts/domain/plans";
import { loadEmergencyStats, type EmergencyStats } from "@/modules/scotus/application/emergency-stats";
import { ALLOTMENT } from "@/modules/scotus/domain/circuit-justice";
import {
  LOWER_GROUP_LABEL, LOWER_GROUPS, parseDashboardFilters, summarize, type Dashboard, type DashboardFilters,
} from "@/modules/scotus/domain/emergency-stats";
import { emergencyProGate, type ProGate } from "@/modules/scotus/http/emergency-pro";
import { easternTime } from "../format";
import { AutoSubmitForm, ChartTooltips } from "./chart-tooltip";
import { DataTable, Donut, Funnel, fmt, heatColor, pct, RateBars, Sparkline, StackedColumns, type Column } from "./charts";
import styles from "./analytics.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Emergency docket analytics (Pro)",
  description: "Grant rates, time to ruling, full-Court referrals and noted dissents on the Supreme Court emergency docket since the 2017 docket year.",
  robots: robotsFor(false),
};

const PATH = "/supreme-court/emergency/analytics";
const APPLICANT_LABEL = { federal: "Federal government", state: "State or local government", private: "Private party" } as const;
const CURRENT_SURNAMES = new Set(ALLOTMENT.map((row) => row.justiceName.replace(/,?\s+Jr\.$/, "").split(/\s+/).at(-1)!));

function justiceName(ref: string): string {
  return /chief/i.test(ref) ? "Chief Justice Roberts" : `Justice ${ref}`;
}
function justiceShort(ref: string): string {
  return /chief/i.test(ref) ? "Roberts (CJ)" : ref;
}
function justiceDetail(ref: string): string | null {
  if (/chief/i.test(ref)) return null;
  return CURRENT_SURNAMES.has(ref) ? null : "former justice";
}
const yy = (term: number) => String(term % 100).padStart(2, "0");

function filterSummary(filters: DashboardFilters): string[] {
  const parts: string[] = [];
  if (filters.term !== null) parts.push(`${filters.term} docket year`);
  if (filters.applicant) parts.push(APPLICANT_LABEL[filters.applicant]);
  if (filters.circuit) parts.push(LOWER_GROUP_LABEL[filters.circuit]);
  if (filters.extensions) parts.push("Extensions included");
  return parts;
}

function termColumns(dashboard: Dashboard, selected: number | null): Column[] {
  return dashboard.byTerm.map((row) => {
    const decided = row.granted + row.grantedInPart + row.denied;
    const rate = decided >= 5 ? Math.round(((row.granted + row.grantedInPart) / decided) * 100) : null;
    return {
      id: String(row.term), label: String(row.term), sublabel: `${yy(row.term)}A`, selected: row.term === selected,
      rate, rateLabel: rate === null ? "" : `${rate}%`,
      segments: [
        { key: "granted", value: row.granted }, { key: "partial", value: row.grantedInPart }, { key: "denied", value: row.denied },
        { key: "other", value: row.closedOther }, { key: "pending", value: row.pending },
      ],
      tip: `${row.term} docket year (${yy(row.term)}A)\n${fmt.format(row.applications)} applications\nGranted ${fmt.format(row.granted)} · in part ${fmt.format(row.grantedInPart)} · denied ${fmt.format(row.denied)}\nWithdrawn, moot or no ruling shown ${fmt.format(row.closedOther)} · pending ${fmt.format(row.pending)}${rate === null ? "" : `\nGrant rate ${rate}% of ${fmt.format(decided)} decided`}`,
    };
  });
}

function Header({ eyebrow, children }: { eyebrow: React.ReactNode; children?: React.ReactNode }) {
  return <header className={styles.hero}>
    <div className={`${styles.wrap} ${styles.heroInner}`}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Jurvio</Link><span aria-hidden="true">/</span><Link href="/supreme-court">Supreme Court</Link><span aria-hidden="true">/</span>
        <Link href={"/supreme-court/emergency" as Route}>Emergency docket</Link><span aria-hidden="true">/</span><span aria-current="page">Analytics</span>
      </nav>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1>Emergency docket <em>analytics</em></h1>
      <p className={styles.lede}>Who wins emergency relief at the Supreme Court, how fast the Court rules, which applications reach the full Court, and where justices publicly dissent.</p>
      {children}
    </div>
  </header>;
}

function Coverage({ stats, dashboard }: { stats: EmergencyStats; dashboard: Dashboard }) {
  const terms = stats.meta.terms.map((row) => row.term);
  const serious = stats.meta.terms.reduce((sum, row) => sum + row.serious, 0);
  return <p className={styles.coverage}>
    <span><span className={styles.dot} aria-hidden="true" /><strong>{fmt.format(serious)}</strong> emergency applications · <strong>{fmt.format(stats.meta.applications)}</strong> with routine extensions</span>
    {terms.length ? <span>Docket years <strong>{Math.min(...terms)}–{Math.max(...terms)}</strong></span> : null}
    <span>Counts rebuilt <strong>{easternTime(stats.meta.refreshedAt)}</strong></span>
    {dashboard.filters.term === null && dashboard.filters.applicant === null && dashboard.filters.circuit === null ? null : <span>Filtered view</span>}
  </p>;
}

function Filters({ dashboard }: { dashboard: Dashboard }) {
  const { filters } = dashboard;
  const active = filterSummary(filters);
  return <>
    <AutoSubmitForm className={styles.filters} action={PATH}>
      <label className={styles.field}><span>Docket year</span>
        <select name="term" defaultValue={filters.term ?? ""}>
          <option value="">All years</option>
          {[...dashboard.termsAvailable].reverse().map((term) => <option key={term} value={term}>{term} ({yy(term)}A)</option>)}
        </select>
      </label>
      <label className={styles.field}><span>Who asked</span>
        <select name="applicant" defaultValue={filters.applicant ?? ""}>
          <option value="">Everyone</option>
          {(Object.keys(APPLICANT_LABEL) as Array<keyof typeof APPLICANT_LABEL>).map((key) => <option key={key} value={key}>{APPLICANT_LABEL[key]}</option>)}
        </select>
      </label>
      <label className={styles.field}><span>Came from</span>
        <select name="circuit" defaultValue={filters.circuit ?? ""}>
          <option value="">Any court</option>
          {LOWER_GROUPS.map((key) => <option key={key} value={key}>{LOWER_GROUP_LABEL[key]}</option>)}
        </select>
      </label>
      <label className={styles.check}><input type="checkbox" name="extensions" value="1" defaultChecked={filters.extensions} /> Include time extensions</label>
      <noscript><button type="submit" className={styles.apply}>Apply</button></noscript>
      {active.length ? <Link className={styles.reset} href={PATH as Route}>Reset</Link> : null}
    </AutoSubmitForm>
    {active.length ? <div className={styles.active} aria-label="Active filters">{active.map((item) => <span key={item}>{item}</span>)}</div> : null}
  </>;
}

function Kpis({ dashboard }: { dashboard: Dashboard }) {
  const t = dashboard.totals;
  const grantedAny = t.granted + t.grantedInPart;
  const rateSeries = dashboard.byTerm.map((row) => {
    const decided = row.granted + row.grantedInPart + row.denied;
    return decided >= 5 ? ((row.granted + row.grantedInPart) / decided) * 100 : null;
  });
  return <div className={styles.kpis}>
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>Applications</span>
      <span className={styles.kpiValue}>{fmt.format(t.applications)}</span>
      <span className={styles.kpiNote}>{fmt.format(t.decided)} decided · {fmt.format(t.pending)} pending · {fmt.format(t.closedOther)} withdrawn, moot or no ruling shown</span>
    </div>
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>Grant rate</span>
      <span className={styles.kpiValue}>{pct(grantedAny, t.decided)}</span>
      <Sparkline values={rateSeries} label={`Grant rate by docket year: ${dashboard.byTerm.map((row, index) => `${row.term} ${rateSeries[index] === null ? "too few" : `${Math.round(rateSeries[index]!)}%`}`).join(", ")}`} />
      <span className={styles.kpiNote}>In whole or in part, of {fmt.format(t.decided)} decided</span>
    </div>
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>Median time to ruling</span>
      <span className={styles.kpiValue}>{t.medianDays ?? "—"}<small>{t.medianDays === 1 ? " day" : " days"}</small></span>
      <span className={styles.kpiNote}>One justice: {dashboard.days.medianJustice ?? "—"} d · Full Court: {dashboard.days.medianCourt ?? "—"} d</span>
    </div>
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>Went to the full Court</span>
      <span className={styles.kpiValue}>{pct(t.referred, t.applications)}</span>
      <span className={styles.kpiNote}>{fmt.format(t.referred)} referred by a justice or decided by the Court</span>
    </div>
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>Response requested</span>
      <span className={styles.kpiValue}>{pct(t.responseRequested, t.applications)}</span>
      <span className={styles.kpiNote}>{fmt.format(t.responseRequested)} times a justice asked the other side to respond</span>
    </div>
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>With a noted dissent</span>
      <span className={styles.kpiValue}>{fmt.format(t.withVotes)}</span>
      <span className={styles.kpiNote}>{pct(t.withVotes, t.decidedByCourt)} of full-Court rulings · a minimum: votes are often not noted</span>
    </div>
  </div>;
}


function Findings({ dashboard }: { dashboard: Dashboard }) {
  const t = dashboard.totals;
  const cards: Array<{ kicker: string; big: React.ReactNode; text: string }> = [];
  const rated = dashboard.byApplicant.filter((cell) => cell.decided >= 5).sort((a, b) => b.granted / b.decided - a.granted / a.decided);
  if (rated.length >= 2) {
    const best = rated[0]!; const worst = rated.at(-1)!;
    const ratio = worst.granted ? (best.granted / best.decided) / (worst.granted / worst.decided) : null;
    cards.push({ kicker: "Who wins", big: <>{pct(best.granted, best.decided)} <small>vs {pct(worst.granted, worst.decided)}</small></>,
      text: `${best.label} applications were granted ${pct(best.granted, best.decided)} of the time (${best.decided} decided); ${worst.label.toLowerCase()} applications ${pct(worst.granted, worst.decided)} (${worst.decided} decided)${ratio && ratio >= 1.5 ? `, about ${ratio.toFixed(1)}× less often` : ""}.` });
  }
  const justiceDecided = t.decided - t.decidedByCourt;
  const justiceGranted = t.granted + t.grantedInPart - t.grantedReferred;
  if (t.decidedByCourt >= 5 && justiceDecided >= 5) {
    cards.push({ kicker: "The full Court is different", big: <>{pct(t.grantedReferred, t.decidedByCourt)} <small>vs {pct(justiceGranted, justiceDecided)}</small></>,
      text: `Applications decided by the full Court were granted ${pct(t.grantedReferred, t.decidedByCourt)} of the time (${t.decidedByCourt} rulings), against ${pct(justiceGranted, justiceDecided)} when one justice ruled alone (${justiceDecided}).` });
  }
  const top = dashboard.votes.leaderboard[0];
  if (top) {
    cards.push({ kicker: "Most noted dissents", big: <>{fmt.format(top.total)} <small>{justiceShort(top.voter)}</small></>,
      text: `${justiceName(top.voter)} has the most publicly noted dissents or "would grant / would deny" notes in this view. Counts are minimums: most emergency rulings do not list votes.` });
  } else if (dashboard.days.median !== null) {
    cards.push({ kicker: "Speed", big: <>{dashboard.days.median} <small>days median</small></>, text: `Half of the ${fmt.format(dashboard.days.measured)} rulings came within ${dashboard.days.median} days of filing.` });
  }
  if (!cards.length) return null;
  return <section className={`${styles.span12} ${styles.findings}`} aria-label="Key findings">
    {cards.map((card) => <article key={card.kicker} className={styles.finding}><span className={styles.findingKicker}>{card.kicker}</span>
      <strong className={styles.findingBig}>{card.big}</strong><p>{card.text}</p></article>)}
  </section>;
}

function Legend({ items }: { items: Array<{ key: string; label: string }> }) {
  return <ul className={styles.legend}>{items.map((item) => <li key={item.key}><i className={`${styles.swatch} ${styles[`sw_${item.key}`]}`} aria-hidden="true" />{item.label}</li>)}</ul>;
}

const OUTCOME_LEGEND = [
  { key: "granted", label: "Granted" }, { key: "partial", label: "Granted in part" }, { key: "denied", label: "Denied" },
  { key: "other", label: "Withdrawn, moot, no ruling shown" }, { key: "pending", label: "Pending" }, { key: "line", label: "Grant rate" },
];

function TermCard({ dashboard, preview = false }: { dashboard: Dashboard; preview?: boolean }) {
  const columns = termColumns(dashboard, dashboard.filters.term);
  return <section className={`${styles.card} ${preview ? styles.span12 : styles.span8}`} aria-labelledby="terms-title">
    <div className={styles.cardHead}>
      <div><h2 id="terms-title">Outcomes by docket year</h2><p>Every application, by the docket year it was numbered in (17A = 2017). The red line is the share granted in whole or in part.</p></div>
      {preview ? <span className={styles.previewLabel}>Free preview</span> : <span className={styles.sampleTag}>n = {fmt.format(dashboard.byTerm.reduce((sum, row) => sum + row.applications, 0))}</span>}
    </div>
    <Legend items={OUTCOME_LEGEND} />
    {columns.length ? <StackedColumns columns={columns} label={`Applications and outcomes by docket year, ${columns.map((column) => column.tip.split("\n").slice(0, 2).join(": ")).join("; ")}`} />
      : <p className={styles.empty}>No applications match these filters.</p>}
    <DataTable caption="Outcomes by docket year" head={["Docket year", "Applications", "Granted", "In part", "Denied", "Withdrawn/moot/no ruling", "Pending", "Grant rate"]}
      rows={dashboard.byTerm.map((row) => [row.term, fmt.format(row.applications), row.granted, row.grantedInPart, row.denied, row.closedOther, row.pending,
        pct(row.granted + row.grantedInPart, row.granted + row.grantedInPart + row.denied)])} />
  </section>;
}

function MixCard({ dashboard }: { dashboard: Dashboard }) {
  const t = dashboard.totals;
  const parts = [
    { key: "granted", label: "Granted", value: t.granted, color: "#0b5bd7" },
    { key: "partial", label: "Granted in part", value: t.grantedInPart, color: "#7ea9f4" },
    { key: "denied", label: "Denied", value: t.denied, color: "#cdd5e1" },
    { key: "other", label: "Withdrawn, moot, no ruling shown", value: t.closedOther, color: "#e9cf9a" },
    { key: "pending", label: "Pending", value: t.pending, color: "#9db3d8" },
  ];
  return <section className={`${styles.card} ${styles.span4}`} aria-labelledby="mix-title">
    <div className={styles.cardHead}><div><h2 id="mix-title">Outcome mix</h2><p>For the current filters.</p></div></div>
    <div className={styles.donutWrap}>
      <Donut segments={parts} center={pct(t.granted + t.grantedInPart, t.decided)} centerLabel="granted" label={`Outcome mix: ${parts.map((part) => `${part.label} ${part.value}`).join(", ")}`} />
      <ul className={styles.mix}>{parts.map((part) => <li key={part.key}><i className={styles.swatch} style={{ background: part.color }} aria-hidden="true" />
        <span>{part.label}</span><b>{fmt.format(part.value)} <small>{pct(part.value, t.applications, 1)}</small></b></li>)}</ul>
    </div>
  </section>;
}

function ApplicantCards({ dashboard }: { dashboard: Dashboard }) {
  const t = dashboard.totals;
  const average = t.decided >= 5 ? (t.granted + t.grantedInPart) / t.decided : null;
  const admin = dashboard.byAdministration;
  return <>
    <section className={`${styles.card} ${styles.span6}`} aria-labelledby="applicant-title">
      <div className={styles.cardHead}><div><h2 id="applicant-title">Who wins: grant rate by applicant</h2><p>Share of decided applications granted in whole or in part. Red tick = all applicants.</p></div></div>
      <RateBars label="Grant rate by applicant" average={average} items={dashboard.byApplicant.map((cell) => ({
        key: cell.key, label: cell.label, part: cell.granted, whole: cell.decided,
        tip: `${cell.label}\n${pct(cell.granted, cell.decided)} granted (${cell.granted} of ${cell.decided} decided)\n${fmt.format(cell.applications)} applications`,
      }))} />
      <DataTable caption="Grant rate by applicant" head={["Applicant", "Applications", "Decided", "Granted", "Rate"]}
        rows={dashboard.byApplicant.map((cell) => [cell.label, cell.applications, cell.decided, cell.granted, pct(cell.granted, cell.decided)])} />
    </section>
    <section className={`${styles.card} ${styles.span6}`} aria-labelledby="admin-title">
      <div className={styles.cardHead}><div><h2 id="admin-title">The federal government, by administration</h2><p>When the Solicitor General or a federal agency asked, by who was President on the filing date.</p></div></div>
      {admin.length ? <RateBars label="Federal government grant rate by administration" average={average} items={admin.map((cell) => ({
        key: cell.key, label: cell.label, part: cell.granted, whole: cell.decided,
        tip: `${cell.label}\n${pct(cell.granted, cell.decided)} granted (${cell.granted} of ${cell.decided} decided)\n${fmt.format(cell.applications)} applications`,
      }))} /> : <p className={styles.note}>No federal government applications match these filters.</p>}
      <p className={styles.note}>Small samples: an administration files a few dozen emergency applications at most, so one ruling moves the rate a lot.</p>
      <DataTable caption="Federal government grant rate by administration" head={["Administration", "Applications", "Decided", "Granted", "Rate"]}
        rows={admin.map((cell) => [cell.label, cell.applications, cell.decided, cell.granted, pct(cell.granted, cell.decided)])} />
    </section>
  </>;
}

function PathCards({ dashboard }: { dashboard: Dashboard }) {
  const t = dashboard.totals;
  const d = dashboard.days;
  const medianIndex = d.median === null ? null : d.bins.findIndex((bin) => d.median! >= bin.from && d.median! <= bin.to);
  const columns: Column[] = d.bins.map((bin) => ({
    id: bin.label, label: bin.label, segments: [{ key: "justice", value: bin.justice }, { key: "court", value: bin.court }],
    tip: `${bin.label === "Same day" ? "Ruled the same day" : `${bin.label} days`}\n${fmt.format(bin.justice + bin.court)} rulings\nOne justice ${fmt.format(bin.justice)} · full Court ${fmt.format(bin.court)}`,
  }));
  return <>
    <section className={`${styles.card} ${styles.span5}`} aria-labelledby="path-title">
      <div className={styles.cardHead}><div><h2 id="path-title">How far applications go</h2><p>From filing to the full Court. Steps overlap rather than nest exactly.</p></div></div>
      <Funnel label="How far applications go" steps={[
        { key: "filed", label: "Filed", value: t.applications, note: "every application", color: "#0b1730" },
        { key: "response", label: "Response requested", value: t.responseRequested, note: `${pct(t.responseRequested, t.applications)} of filed`, color: "#123a8a" },
        { key: "referred", label: "Went to the full Court", value: t.referred, note: `${pct(t.referred, t.applications)} of filed`, color: "#0b5bd7" },
        { key: "granted", label: "Granted by the full Court", value: t.grantedReferred, note: `${pct(t.grantedReferred, t.decidedByCourt)} of full-Court rulings`, color: "#e3483e" },
      ]} />
      {t.adminStay || t.written ? <p className={styles.note}>{t.adminStay ? `Administrative stays (a pause while the Court decides): ${fmt.format(t.adminStay)}. ` : ""}{t.written ? `Rulings with written reasons: ${fmt.format(t.written)}.` : ""}</p> : null}
    </section>
    <section className={`${styles.card} ${styles.span7}`} aria-labelledby="days-title">
      <div className={styles.cardHead}><div><h2 id="days-title">Time from filing to ruling</h2><p>Days from the application to the grant or denial. Most single-justice rulings are fast; full-Court rulings take longer.</p></div>
        <span className={styles.sampleTag}>n = {fmt.format(d.measured)}</span></div>
      <Legend items={[{ key: "justice", label: `One justice (median ${d.medianJustice ?? "—"} d)` }, { key: "court", label: `Full Court (median ${d.medianCourt ?? "—"} d)` }]} />
      <StackedColumns columns={columns} medianAt={medianIndex === -1 ? null : medianIndex} medianLabel={d.median === null ? undefined : `Median ${d.median} d`}
        label={`Days to ruling: ${columns.map((column) => column.tip.split("\n").slice(0, 2).join(" ")).join("; ")}`} />
      <DataTable caption="Days from filing to ruling" head={["Days", "One justice", "Full Court", "Total"]}
        rows={d.bins.map((bin) => [bin.label, bin.justice, bin.court, bin.justice + bin.court])} />
    </section>
  </>;
}

function JusticeCard({ dashboard }: { dashboard: Dashboard }) {
  const rows = dashboard.byJustice;
  const max = Math.max(1, ...rows.map((row) => row.applications));
  return <section className={`${styles.card} ${styles.span12}`} aria-labelledby="justice-title">
    <div className={styles.cardHead}><div><h2 id="justice-title">Circuit justices: who gets the application, and what happens</h2>
      <p>Applications go first to the justice for the circuit. Referral rate = share that justice (or the Court) sent to the full Court.</p></div></div>
    {rows.length ? <ul className={styles.justices}>
      <li className={`${styles.justiceRow} ${styles.justiceHead}`} aria-hidden="true"><span>Justice</span><span>Applications</span><span>Went to full Court</span><span>Granted (of decided)</span></li>
      {rows.map((row) => {
        const detail = justiceDetail(row.key);
        return <li key={row.key} className={styles.justiceRow} tabIndex={0}
          data-tip={`${justiceName(row.key)}\n${fmt.format(row.applications)} applications\n${pct(row.referred, row.applications)} went to the full Court (${row.referred})\n${pct(row.granted, row.decided)} granted (${row.granted} of ${row.decided} decided)`}>
          <span className={styles.justiceName}>{justiceName(row.key)} <span className={styles.phoneApps}>· {fmt.format(row.applications)} applications</span>{detail ? <small>{detail}</small> : null}</span>
          <span className={`${styles.miniBar} ${styles.apps}`} data-label="Apps"><span className={styles.miniTrack}><span className={styles.miniFill} style={{ width: `${(row.applications / max) * 100}%` }} /></span>{fmt.format(row.applications)}</span>
          <span className={styles.miniBar} data-label="Full Court"><span className={styles.miniTrack}><span className={`${styles.miniFill} ${styles.miniFillBlue}`} style={{ width: `${(row.applications >= 5 ? row.referred / row.applications : 0) * 100}%` }} /></span>{pct(row.referred, row.applications)}</span>
          <span className={styles.miniBar} data-label="Granted"><span className={styles.miniTrack}><span className={`${styles.miniFill} ${styles.miniFillRed}`} style={{ width: `${(row.decided >= 5 ? row.granted / row.decided : 0) * 100}%` }} /></span>{pct(row.granted, row.decided)}</span>
        </li>;
      })}
    </ul> : <p className={styles.note}>No applications match these filters.</p>}
    <DataTable caption="Circuit justices" head={["Justice", "Applications", "Went to full Court", "Decided", "Granted", "Grant rate"]}
      rows={rows.map((row) => [justiceName(row.key), row.applications, row.referred, row.decided, row.granted, pct(row.granted, row.decided)])} />
  </section>;
}

function CourtsCard({ dashboard }: { dashboard: Dashboard }) {
  const rows = dashboard.byLowerGroup.slice(0, 12);
  const t = dashboard.totals;
  const average = t.decided >= 5 ? (t.granted + t.grantedInPart) / t.decided : null;
  return <section className={`${styles.card} ${styles.span6}`} aria-labelledby="courts-title">
    <div className={styles.cardHead}><div><h2 id="courts-title">Where applications come from</h2><p>Grant rate by the court below; district courts count with their circuit. Most active first.</p></div></div>
    <RateBars label="Grant rate by lower court" average={average} items={rows.map((cell) => ({
      key: cell.key, label: cell.label, detail: `${fmt.format(cell.applications)} applications · ${fmt.format(cell.decided)} decided`, part: cell.granted, whole: cell.decided,
      tip: `${cell.label}\n${fmt.format(cell.applications)} applications\n${pct(cell.granted, cell.decided)} granted (${cell.granted} of ${cell.decided} decided)`,
    }))} />
    <DataTable caption="Grant rate by lower court" head={["Court below", "Applications", "Decided", "Granted", "Rate"]}
      rows={dashboard.byLowerGroup.map((cell) => [cell.label, cell.applications, cell.decided, cell.granted, pct(cell.granted, cell.decided)])} />
  </section>;
}

function DissentCards({ dashboard }: { dashboard: Dashboard }) {
  const board = dashboard.votes.leaderboard.slice(0, 10);
  const top = Math.max(1, ...board.map((row) => row.total));
  const heat = dashboard.votes.heatmap;
  const max = Math.max(1, ...heat.voters.flatMap((voter) => Object.values(heat.cells[voter] ?? {})));
  const columns = `minmax(92px,130px) repeat(${heat.terms.length}, minmax(40px,1fr)) 46px`;
  return <>
    <section className={`${styles.card} ${styles.span6}`} aria-labelledby="dissent-title">
      <div className={styles.cardHead}><div><h2 id="dissent-title">Noted dissents leaderboard</h2>
        <p>{dashboard.filters.term === null ? "All docket years." : `${dashboard.filters.term} docket year.`} Dissents and &ldquo;would grant / would deny&rdquo; notes on the docket.</p></div></div>
      {board.length ? <ol className={styles.leader}>{board.map((row) => <li key={row.voter} tabIndex={0}
        data-tip={`${justiceName(row.voter)}\n${row.total} noted: ${row.dissents} dissents, ${row.wouldGrant} would grant, ${row.wouldDeny} would deny`}>
        <span>{justiceName(row.voter)}</span><b>{fmt.format(row.total)}</b>
        <span className={styles.leaderBar} aria-hidden="true"><i style={{ width: `${(row.total / top) * 100}%` }} /></span>
      </li>)}</ol> : <p className={styles.note}>No noted dissents match these filters.</p>}
      <p className={styles.note}>These are minimums. On most emergency rulings the Court does not say how each justice voted.</p>
    </section>
    <section className={`${styles.card} ${styles.span12}`} aria-labelledby="heat-title">
      <div className={styles.cardHead}><div><h2 id="heat-title">Dissent heatmap by docket year</h2><p>Noted dissents per justice per docket year. Darker = more.</p></div></div>
      {heat.voters.length ? <>
        <div className={styles.heatScroll} tabIndex={0} aria-label="Dissent heatmap; scroll sideways for more years">
          <div className={styles.heat} role="presentation">
            <div className={styles.heatRow} style={{ gridTemplateColumns: columns }} aria-hidden="true">
              <span className={styles.heatName} />{heat.terms.map((term) => <span key={term} className={styles.heatHead}>{term}</span>)}<span className={styles.heatHead}>Total</span>
            </div>
            {heat.voters.map((voter) => {
              const cells = heat.cells[voter] ?? {};
              const total = Object.values(cells).reduce((sum, value) => sum + value, 0);
              return <div key={voter} className={styles.heatRow} style={{ gridTemplateColumns: columns }}>
                <span className={styles.heatName}>{justiceShort(voter)}</span>
                {heat.terms.map((term) => {
                  const value = cells[term] ?? 0;
                  return <span key={term} className={styles.heatCell} style={heatColor(value, max)} tabIndex={-1} data-tip={`${justiceName(voter)} · ${term}\n${value} noted dissent${value === 1 ? "" : "s"}`}>{value || ""}</span>;
                })}
                <span className={styles.heatTotal}>{total}</span>
              </div>;
            })}
          </div>
        </div>
        <p className={styles.swipeHint} aria-hidden="true">Swipe sideways for more years →</p>
        <div className={styles.scale} aria-hidden="true">Fewer <i /> More</div>
      </> : <p className={styles.note}>No noted dissents match these filters.</p>}
      <DataTable caption="Noted dissents by justice and docket year" head={["Justice", ...heat.terms.map(String), "Total"]}
        rows={heat.voters.map((voter) => [justiceName(voter), ...heat.terms.map((term) => heat.cells[voter]?.[term] ?? 0), Object.values(heat.cells[voter] ?? {}).reduce((sum, value) => sum + value, 0)])} />
    </section>
  </>;
}

function Caveats({ stats }: { stats: EmergencyStats }) {
  const speed = stats.meta.speed;
  return <section className={`${styles.card} ${styles.span12}`} aria-labelledby="method-title">
    <div className={styles.cardHead}><div><h2 id="method-title">How to read these numbers</h2></div></div>
    <ul className={styles.caveats}>
      <li><strong>Source</strong>The Court&apos;s own public docket pages for each application, back to the 2017 docket year. Docket lines that mention sealed or restricted material are never read into these counts.</li>
      <li><strong>Votes are often not noted</strong>The Court usually rules on emergency applications without saying how each justice voted, so dissent counts are minimums, not vote tallies.</li>
      <li><strong>Sample sizes</strong>Rates are shown only when at least 5 applications were decided; smaller groups show &ldquo;n&lt;5&rdquo;. Each chart lists its n.</li>
      <li><strong>No ruling shown</strong>Some older applications never show a ruling on their own docket (the page just says the application was &ldquo;completed&rdquo;, often because the Court ruled on a related petition). After a year they are counted as &ldquo;no ruling shown&rdquo;, not as pending or denied.</li>
      <li><strong>Extensions</strong>Requests for more time to file a petition are routine and almost always granted, so they are left out unless you include them.</li>
      <li><strong>Docket year</strong>Applications are numbered by the Court&apos;s docket year (24A = filed from about mid-2024 to mid-2025), not the calendar year.</li>
      <li><strong>Freshness</strong>Counts are rebuilt in the background after the Court&apos;s docket changes; the newest applications appear within about 10 to 20 minutes of the Court posting them, then in these counts at the next rebuild.{speed.lines >= 20 && speed.medianMinutesAfterDocketDay !== null ? ` Across ${fmt.format(speed.lines)} recent docket updates, Jurvio stored the median one ${Math.round(speed.medianMinutesAfterDocketDay / 60)} hours after the start of its docket day.` : ""}</li>
    </ul>
    <DataTable summary="Coverage by docket year" caption="Applications held by docket year" head={["Docket year", "Applications", "Emergency (not extensions)"]}
      rows={stats.meta.terms.map((row) => [row.term, fmt.format(row.applications), fmt.format(row.serious)])} />
  </section>;
}

/* ---------- Teaser (signed out / Free) ---------- */

const FAKE_RATES = [
  { key: "a", label: "Federal government", part: 7, whole: 10 }, { key: "b", label: "State or local government", part: 5, whole: 10 },
  { key: "c", label: "Private party", part: 1, whole: 10 },
];

function LockedKpi({ label, fake, note }: { label: string; fake: string; note: string }) {
  return <div className={`${styles.kpi} ${styles.locked}`}>
    <svg className={styles.lockIcon} width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M3 8V5.5a5 5 0 0 1 10 0V8" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="1" y="8" width="14" height="10" rx="2.5" fill="currentColor" /></svg>
    <span className={styles.kpiLabel}>{label}</span>
    <span className={styles.kpiValue} aria-hidden="true">{fake}</span>
    <span className={styles.srOnly}>Available with Pro</span>
    <span className={styles.kpiNote}>{note}</span>
  </div>;
}

function Teaser({ gate, stats }: { gate: Extract<ProGate, { ok: false }>; stats: EmergencyStats | null }) {
  const dashboard = stats ? summarize(stats.stats, stats.votes, { term: null, applicant: null, circuit: null, extensions: false }) : null;
  const signedOut = gate.reason === "signed_out";
  const plans = [PLANS.free, PLANS.plus, PLANS.pro];
  const terms = stats?.meta.terms.map((row) => row.term) ?? [];
  return <main className={styles.page}>
    <ChartTooltips>
      <Header eyebrow={<><span className={styles.proBadge}>PRO</span> Supreme Court emergency docket</>}>
        {stats && dashboard ? <Coverage stats={stats} dashboard={dashboard} /> : null}
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Applications analyzed</span>
            <span className={styles.kpiValue}>{dashboard ? fmt.format(dashboard.totals.applications) : "—"}</span>
            <span className={styles.kpiNote}>Emergency applications, routine extensions left out</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Docket years</span>
            <span className={styles.kpiValue}>{terms.length || "—"}</span>
            <span className={styles.kpiNote}>{terms.length ? `${Math.min(...terms)} to ${Math.max(...terms)}` : "Loading history"}</span>
          </div>
          <LockedKpi label="Grant rate" fake="48%" note="By applicant, administration, circuit" />
          <LockedKpi label="Median time to ruling" fake="6 days" note="One justice vs. the full Court" />
          <LockedKpi label="Went to the full Court" fake="31%" note="By circuit justice" />
          <LockedKpi label="With a noted dissent" fake="214" note="Leaderboard and heatmap" />
        </div>
      </Header>
      <div className={`${styles.wrap} ${styles.body}`}>
        <div className={styles.grid}>
          {dashboard ? <TermCard dashboard={dashboard} preview /> : null}
          <div className={`${styles.span12} ${styles.teaserGrid}`}>
            <div className={`${styles.grid} ${styles.blurred}`} aria-hidden="true" inert>
              <section className={`${styles.card} ${styles.span6}`}><div className={styles.cardHead}><h2>Who wins: grant rate by applicant</h2></div>
                <RateBars label="" average={0.45} items={FAKE_RATES.map((item) => ({ ...item, tip: "" }))} /></section>
              <section className={`${styles.card} ${styles.span6}`}><div className={styles.cardHead}><h2>The federal government, by administration</h2></div>
                <RateBars label="" average={0.45} items={FAKE_RATES.map((item, index) => ({ ...item, label: ["Administration A", "Administration B", "Administration C"][index]!, tip: "" }))} /></section>
              <section className={`${styles.card} ${styles.span7}`}><div className={styles.cardHead}><h2>Time from filing to ruling</h2></div>
                <StackedColumns label="" columns={[3, 6, 9, 7, 5, 3, 2, 1].map((value, index) => ({ id: String(index), label: "··", tip: "", segments: [{ key: "justice", value }, { key: "court", value: Math.max(0, value - 3) }] }))} /></section>
              <section className={`${styles.card} ${styles.span5}`}><div className={styles.cardHead}><h2>Noted dissents leaderboard</h2></div>
                <ol className={styles.leader}>{[9, 7, 6, 4, 2].map((value, index) => <li key={index}><span>Justice ········</span><b>{value * 7}</b><span className={styles.leaderBar}><i style={{ width: `${value * 11}%` }} /></span></li>)}</ol></section>
            </div>
            <div className={styles.lockOverlay}>
              <div className={styles.upgrade}>
                <span className={styles.proBadge}>PRO</span>
                <h2>See who wins at the Court&apos;s emergency docket</h2>
                <p>Grant rates for the federal government, states and private parties; every administration since 2017; each circuit justice; how long rulings take; and which justices publicly dissent, with filters for year, applicant and court.</p>
                <ul className={styles.perks}>
                  <li>Interactive charts back to the 2017 docket year</li>
                  <li>Filters by year, applicant and lower court</li>
                  <li>Dissent leaderboard and heatmap</li>
                  <li>Emergency alerts every 10 minutes, deadline calendar, CSV</li>
                </ul>
                <div className={styles.plans}>{plans.map((plan) => <div key={plan.id} className={`${styles.plan} ${plan.id === "pro" ? styles.planPro : ""}`}>
                  <b>{plan.name}</b><strong>{formatMonthlyPrice(plan)}</strong><small>{plan.id === "pro" ? "Includes analytics" : plan.id === "plus" ? "More follows" : "Preview"}</small></div>)}</div>
                <div className={styles.ctaRow}>
                  <Link className={styles.cta} href={"/pricing?feature=emergency" as Route}>Upgrade to Pro →</Link>
                  {signedOut ? <Link className={styles.ctaGhost} href={`/signin?next=${encodeURIComponent(PATH)}` as Route} rel="nofollow">Sign in</Link>
                    : <Link className={styles.ctaGhost} href={"/supreme-court/emergency" as Route}>Back to the docket</Link>}
                </div>
                <p className={styles.finePrint}>Paid plans are not open yet: join the waitlist with just your email. {signedOut ? "Already on Pro? Sign in." : ""}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ChartTooltips>
  </main>;
}

export default async function EmergencyAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [gate, params] = await Promise.all([emergencyProGate(), searchParams]);
  const stats = await loadEmergencyStats(db());
  if (!gate.ok) return <Teaser gate={gate} stats={stats} />;
  if (!stats) {
    return <main className={styles.page}>
      <Header eyebrow={<><span className={styles.proBadge}>PRO</span> Supreme Court emergency docket</>} />
      <div className={`${styles.wrap} ${styles.body}`}><div className={styles.empty}><h2>Analytics are being prepared</h2><p>The counts are rebuilt in the background. Try again in a few minutes.</p></div></div>
    </main>;
  }
  const terms = [...new Set(stats.stats.map((row) => row.term))].sort((a, b) => a - b);
  const filters = parseDashboardFilters(params, terms);
  const dashboard = summarize(stats.stats, stats.votes, filters);
  return <main className={styles.page}>
    <ChartTooltips>
      <Header eyebrow={<><span className={styles.proBadge}>PRO</span> Supreme Court emergency docket</>}>
        <Coverage stats={stats} dashboard={dashboard} />
        <Filters dashboard={dashboard} />
        <Kpis dashboard={dashboard} />
      </Header>
      <div className={`${styles.wrap} ${styles.body}`}>
        <div className={styles.grid}>
          <Findings dashboard={dashboard} />
          <TermCard dashboard={dashboard} />
          <MixCard dashboard={dashboard} />
          <ApplicantCards dashboard={dashboard} />
          <PathCards dashboard={dashboard} />
          <JusticeCard dashboard={dashboard} />
          <CourtsCard dashboard={dashboard} />
          <DissentCards dashboard={dashboard} />
          <Caveats stats={stats} />
        </div>
      </div>
    </ChartTooltips>
  </main>;
}
