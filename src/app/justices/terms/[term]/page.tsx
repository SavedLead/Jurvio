import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { listDatasetReleases } from "@/modules/scotus/application/justice-analytics";
import { loadTermBreakdown } from "@/modules/scotus/application/term-breakdown";
import { percent, shortName, termLabel } from "@/modules/scotus/domain/justice-lineup";
import { DECISION_TYPE_LABELS, externalCheck, martinQuinnReleaseLabel, type IssueCell, type ScopeBreakdown } from "@/modules/scotus/domain/term-breakdown";
import { DirectionExplainer, EvidenceLedger, MQ_HOME, SCDB_DIRECTION_LABEL } from "@/modules/scotus/ui/justice-ui";
import styles from "@/modules/scotus/ui/justices.module.css";

export const dynamic = "force-dynamic";

const load = unstable_cache(
  async (term: number) => {
    const sql = db();
    const [page, releases] = await Promise.all([loadTermBreakdown(sql, term), listDatasetReleases(sql)]);
    return { page, releases };
  },
  ["public-justice-term-breakdown-v1"],
  { revalidate: 3600, tags: ["public-justices"] },
);

type Params = { term: string };
type Search = { view?: string | string[] };

function parseTerm(raw: string): number | null {
  const match = /^(?:ot)?(\d{4})$/i.exec(raw);
  return match ? Number(match[1]) : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const term = parseTerm((await params).term);
  if (term === null) return {};
  return {
    title: `Supreme Court ${termLabel(term)} in numbers: vote splits, 5–4 decisions and how each justice voted`,
    description: `Every ${termLabel(term)} decision from the Supreme Court Database: vote splits, each 5–4 decision with the majority and the dissent, opinions written, and each justice’s share of votes ${SCDB_DIRECTION_LABEL}, with every denominator shown.`,
    alternates: { canonical: `/justices/terms/${term}` },
  };
}

const share = (n: number, d: number) => d > 0 ? `${percent(n / d)} (${n} of ${d})` : "no coded votes";

function SplitTable({ argued, all, usual }: { argued: ScopeBreakdown; all: ScopeBreakdown; usual: string | null }) {
  const keys = [...new Set([...argued.splits, ...all.splits].map((s) => s.split))];
  const order = all.splits.map((s) => s.split);
  keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const count = (scope: ScopeBreakdown, key: string) => scope.splits.find((s) => s.split === key)?.decisions ?? 0;
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>Vote split</th><th className={styles.num}>Argued cases ({argued.decisions})</th><th className={styles.num}>Every decision ({all.decisions})</th></tr></thead>
    <tbody>
      {keys.map((key) => <tr key={key}><td>{key}</td>
        <td className={styles.num}>{count(argued, key)} ({percent(argued.decisions ? count(argued, key) / argued.decisions : null)})</td>
        <td className={styles.num}>{count(all, key)} ({percent(all.decisions ? count(all, key) / all.decisions : null)})</td></tr>)}
      <tr><td><strong>Unanimous</strong> (no dissenting vote: 9–0, 8–0, …)</td>
        <td className={styles.num}>{share(argued.unanimous, argued.decisions)}</td><td className={styles.num}>{share(all.unanimous, all.decisions)}</td></tr>
      {usual ? <tr><td><strong>6–3 along the usual lines</strong> (see the definition below)</td><td className={styles.num}>{usual}</td><td className={styles.num}>argued only</td></tr> : null}
      {argued.splitUnknown || all.splitUnknown ? <tr><td>Vote split not recorded by SCDB</td><td className={styles.num}>{argued.splitUnknown}</td><td className={styles.num}>{all.splitUnknown}</td></tr> : null}
    </tbody>
  </table></div>;
}

export default async function TermPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const raw = (await params).term;
  const term = parseTerm(raw);
  if (term === null) notFound();
  const viewParam = (await searchParams).view;
  const { page, releases } = await load(term);
  if (!page) notFound();
  const { breakdown: b, shared, justices, issueLabels, martinQuinn, scdbVersion, terms } = page;
  const view = (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "shared" && shared ? "shared" : "term";
  const name = new Map(justices.map((j) => [j.scdbJusticeId, shortName(j.displayName)]));
  const names = (ids: number[]) => justices.filter((j) => ids.includes(j.scdbJusticeId)).map((j) => shortName(j.displayName)).join(", ");
  const check = externalCheck(term);
  const usual = b.usualLines;
  const majoritySix = usual ? justices.filter((j) => !usual.minority.includes(j.scdbJusticeId)).map((j) => shortName(j.displayName)).join(", ") : "";
  const issueSource = view === "shared" && shared ? shared.breakdown : b;
  const issueRows = Object.entries(issueSource.issues)
    .map(([area, byJustice]) => ({ area: Number(area), byJustice, total: Object.values(byJustice).reduce((n, c) => Math.max(n, c.withDirection + c.withoutDirection), 0) }))
    .sort((x, y) => y.total - x.total);
  const counts = new Map(b.justices.map((j) => [j.scdbJusticeId, j]));
  const mqBehind = martinQuinn.latestTerm !== null && martinQuinn.latestTerm < term;
  const cell = (c: IssueCell | undefined) => !c || c.withDirection === 0 ? "no coded votes" : `${percent(c.liberal / c.withDirection)} (${c.liberal}/${c.withDirection})`;
  const picker = terms.slice(0, 30);

  return <main className={styles.page}>
    <nav className={styles.breadcrumbs}><Link href="/">Jurvio</Link> / <Link href={"/justices" as Route}>Justices</Link> / {termLabel(term)}</nav>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Supreme Court analytics</p>
      <h1>The {termLabel(term)} term in numbers</h1>
      <p>Every decision the Supreme Court Database records for the October {term} Term: how the votes split, every 5–4 decision and who was on each side, how many opinions each justice wrote, and how each justice voted by subject. Each number shows what it was counted out of.</p>
      <div className={styles.termPicker} aria-label="Choose a term">{picker.map((value) => <Link key={value} href={`/justices/terms/${value}` as Route} aria-current={value === term ? "page" : undefined}>{value}</Link>)}</div>
    </header>

    <section className={styles.section} aria-labelledby="coverage">
      <span className={styles.tag}>Coverage</span>
      <h2 id="coverage">Is this term complete?</h2>
      <dl className={styles.facts}>
        <div><dt>Decisions in SCDB {scdbVersion ?? ""}</dt><dd>{b.coverage.decisions}: {Object.entries(b.coverage.byDecisionType).map(([type, n]) => `${DECISION_TYPE_LABELS[type] ?? `SCDB decision type ${type}`}: ${n}`).join("; ")}</dd></div>
        <div><dt>Argued cases</dt><dd>{b.coverage.argued} (SCDB decision types 1, 6 and 7)</dd></div>
        <div><dt>Decision dates</dt><dd>{b.coverage.firstDecided ?? "—"} to {b.coverage.lastDecided ?? "—"}</dd></div>
        <div><dt>Checked against</dt><dd>{check
          ? <>{check.source} (checked {check.checkedOn}): {check.decisions} decisions, {check.argued} argued, {check.fiveFour} decided 5–4, {check.sixThreeArgued} argued cases decided 6–3, {check.unanimous} unanimous. {check.decisions === b.coverage.decisions && check.argued === b.coverage.argued && check.fiveFour === b.all.fiveFour && check.sixThreeArgued === b.argued.sixThree && check.unanimous === b.all.unanimous ? "Every one of these matches the SCDB release." : "Some counts differ from the SCDB release; the SCDB numbers are shown on this page."} {check.note} <a className={styles.link} href={check.sourceUrl} rel="noopener">Source →</a></>
          : "Not independently checked. The numbers are as published in the SCDB release; the SCDB adds a term only after it ends and can revise earlier codes."}</dd></div>
        <div><dt>Decisions with no SCDB direction</dt><dd>{b.coverage.withoutDirection} of {b.coverage.decisions}</dd></div>
        <div><dt>Martin-Quinn</dt><dd>{martinQuinn.latestTerm === null ? "No Martin-Quinn scores loaded." : `Latest published scores: ${termLabel(martinQuinn.latestTerm)} (${martinQuinnReleaseLabel(martinQuinn.releaseVersion)}).${mqBehind ? ` There are no ${termLabel(term)} scores yet, so the scores below are each justice’s most recent published score, labelled with its term.` : ""}`}</dd></div>
      </dl>
    </section>

    <section className={styles.section} aria-labelledby="splits">
      <span className={styles.tag}>Facts from SCDB</span>
      <h2 id="splits">How the votes split</h2>
      <p>The split is SCDB’s count of votes in the majority and in dissent. An 8–0 or 6–2 split means a justice did not take part.</p>
      <SplitTable argued={b.argued} all={b.all} usual={usual ? `${usual.decisions} of ${usual.sixThree} argued 6–3 decisions` : null} />
      {usual ? <p><strong>“Along the usual lines”</strong> means a 6–3 argued decision where the three dissenters were the three justices with the highest share of votes {SCDB_DIRECTION_LABEL} this term ({names(usual.minority)}), and the other six ({majoritySix}) were the majority. The trio is picked from the data each term, not by name.</p>
        : <p>“Usual lines” is not shown for this term: it needs a nine-member Court with a clear top three by SCDB-coded liberal share.</p>}
    </section>

    <section className={styles.section} aria-labelledby="five-four">
      <span className={styles.tag}>Facts from SCDB</span>
      <h2 id="five-four">Every 5–4 decision ({b.fiveFourDecisions.length})</h2>
      {b.fiveFourDecisions.length ? <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Case</th><th>Decided</th><th>Docket</th><th>Opinion by</th><th>Majority (5)</th><th>Dissent (4)</th></tr></thead>
        <tbody>{b.fiveFourDecisions.map((d) => <tr key={d.scdbCaseId}>
          <td>{d.caseName}{d.argued ? "" : " (decided without argument)"}</td><td>{d.decidedOn ?? "—"}</td><td>{d.docket ?? "—"}</td>
          <td>{d.opinionBy === null ? "Unsigned (per curiam)" : name.get(d.opinionBy) ?? "—"}</td>
          <td>{names(d.majority)}</td><td>{names(d.dissent)}</td>
        </tr>)}</tbody>
      </table></div> : <p>The SCDB records no 5–4 decisions this term.</p>}
    </section>

    <section className={styles.section} aria-labelledby="justices">
      <span className={styles.tag}>Facts from SCDB</span>
      <h2 id="justices">Each justice’s record, argued cases</h2>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Justice</th><th className={styles.num}>Votes cast</th><th className={styles.num}>Did not take part</th><th className={styles.num}>SCDB-coded liberal</th><th className={styles.num}>No direction</th><th className={styles.num}>In the majority</th><th className={styles.num}>Majority opinions</th><th className={styles.num}>Concurrences written</th><th className={styles.num}>Dissents written</th><th>Martin-Quinn (95% range)</th></tr></thead>
        <tbody>{justices.map((j) => {
          const c = counts.get(j.scdbJusticeId);
          const mq = martinQuinn.scores[j.scdbJusticeId];
          return <tr key={j.scdbJusticeId}>
            <td><Link className={styles.link} href={`/justices/${j.slug}` as Route}>{shortName(j.displayName)}</Link></td>
            <td className={styles.num}>{c?.votesCast ?? 0}</td><td className={styles.num}>{c?.didNotVote ?? 0}</td>
            <td className={styles.num}>{c ? share(c.liberal, c.withDirection) : "—"}</td><td className={styles.num}>{c?.withoutDirection ?? 0}</td>
            <td className={styles.num}>{c ? share(c.inMajority, c.inMajority + c.inDissent) : "—"}</td>
            <td className={styles.num}>{c?.majorityOpinions ?? 0}</td><td className={styles.num}>{c?.concurrencesWritten ?? 0}</td><td className={styles.num}>{c?.dissentsWritten ?? 0}</td>
            <td>{mq ? `${mq.mean.toFixed(2)} (${mq.low.toFixed(2)} to ${mq.high.toFixed(2)}), ${termLabel(mq.term)}` : "not published"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p><strong>How SCDB counts opinions.</strong> Majority opinions are the SCDB’s majority-opinion author for each argued case; unsigned per curiam opinions have no author. A concurrence or dissent is counted when the justice wrote or co-wrote an opinion and the SCDB codes that justice’s vote as a concurrence or a dissent. The SCDB records one vote per justice per case, so a separate opinion that partly concurs and partly dissents counts once, under the vote the SCDB coded, and a justice who writes two separate opinions in one case counts once. That is why these numbers can differ a little from trackers that count every opinion document.</p>
      <p>Liberal share is votes {SCDB_DIRECTION_LABEL}, out of votes the SCDB gave a direction. “In the majority” is out of votes with a recorded side. Martin-Quinn scores are the authors’ estimates on their own scale (below zero toward liberal, above zero toward conservative), shown unchanged with the term they cover. <a className={styles.link} href={MQ_HOME} rel="noopener">Martin-Quinn project →</a></p>
    </section>

    <section className={styles.section} aria-labelledby="issues">
      <span className={styles.tag}>Facts from SCDB</span>
      <h2 id="issues">Liberal share by subject (SCDB issue area)</h2>
      {shared ? <nav className={styles.scope} aria-label="Which terms to count">
        <span>Count:</span>
        <Link href={`/justices/terms/${term}` as Route} aria-current={view === "term" ? "page" : undefined}>{termLabel(term)} only</Link>
        <Link href={`/justices/terms/${term}?view=shared` as Route} aria-current={view === "shared" ? "page" : undefined}>Shared tenure, {termLabel(shared.fromTerm)}–{termLabel(shared.toTerm)}</Link>
      </nav> : null}
      <p>Each cell is the share of that justice’s votes {SCDB_DIRECTION_LABEL} in argued cases of that SCDB issue area, with the count it is out of. Small areas rest on very few votes.{view === "shared" && shared ? ` Shared tenure starts with ${termLabel(shared.fromTerm)}, the first term all nine of these justices sat together.` : ""}</p>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Issue area (SCDB)</th>{justices.map((j) => <th key={j.scdbJusticeId} className={styles.num}>{shortName(j.displayName)}</th>)}</tr></thead>
        <tbody>{issueRows.map((row) => <tr key={row.area}>
          <td>{issueLabels[row.area] ?? `Issue area ${row.area}`}</td>
          {justices.map((j) => <td key={j.scdbJusticeId} className={styles.num}>{cell(row.byJustice[j.scdbJusticeId])}</td>)}
        </tr>)}</tbody>
      </table></div>
      <p>Votes with no SCDB direction code (for example most interstate-relations cases, and any case the SCDB gives no issue area) are left out of the cells and counted here: {justices.map((j) => {
        const unknown = issueSource.justices.find((x) => x.scdbJusticeId === j.scdbJusticeId)?.withoutDirection ?? 0;
        return `${shortName(j.displayName)} ${unknown}`;
      }).join(", ")}.</p>
    </section>

    <DirectionExplainer />
    <EvidenceLedger
      releases={releases}
      items={[
        { label: "Term", value: `${termLabel(term)}: decisions the SCDB assigns to the October ${term} Term` },
        { label: "Decisions", value: `${b.coverage.decisions} (${b.coverage.argued} argued)` },
        { label: "Votes", value: `${b.justices.reduce((n, j) => n + j.votesCast, 0)} votes cast in argued cases; ${b.justices.reduce((n, j) => n + j.didNotVote, 0)} times a justice did not take part` },
        { label: "Labels", value: `Direction is ${SCDB_DIRECTION_LABEL}. Jurvio does not label justices by party.` },
      ]}
      coverage={{ label: "decisions with an SCDB direction code", numerator: b.coverage.decisions - b.coverage.withoutDirection, denominator: b.coverage.decisions }}
      notes={["Vote splits, sides, opinion authors, issue areas and directions are the SCDB’s codes, not Jurvio’s reading of the opinions."]}
    />
  </main>;
}
