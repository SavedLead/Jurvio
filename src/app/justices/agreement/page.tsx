import Link from "next/link";
import type { Metadata, Route } from "next";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import {
  listDatasetReleases, listMatrixTerms, loadAgreementMatrix, matrixKey, parseScope, type JusticeScope,
} from "@/modules/scotus/application/justice-analytics";
import { percent, shortName, termLabel } from "@/modules/scotus/domain/justice-lineup";
import { agreementColor, EvidenceLedger, ScopeToggle, SCDB_DIRECTION_LABEL } from "@/modules/scotus/ui/justice-ui";
import styles from "@/modules/scotus/ui/justices.module.css";

export const dynamic = "force-dynamic";

const loadTerms = unstable_cache(async () => listMatrixTerms(db()), ["public-justice-matrix-terms-v1"], { revalidate: 3600, tags: ["public-justices"] });
const load = unstable_cache(
  async (term: number, scope: JusticeScope) => {
    const sql = db();
    const [matrix, releases] = await Promise.all([loadAgreementMatrix(sql, term, scope), listDatasetReleases(sql)]);
    return { matrix, releases };
  },
  ["public-justice-matrix-v1"],
  { revalidate: 3600, tags: ["public-justices"] },
);

export const metadata: Metadata = {
  title: "Supreme Court Justice Agreement Matrix",
  description: "How often each pair of Supreme Court justices voted on the same side, term by term, from the Supreme Court Database, with every denominator shown.",
  alternates: { canonical: "/justices/agreement" },
};

type Params = { scope?: string | string[]; term?: string | string[] };

export default async function AgreementPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const scope = parseScope(params.scope);
  const terms = await loadTerms();
  const requested = Number.parseInt(String(Array.isArray(params.term) ? params.term[0] : params.term ?? ""), 10);
  const term = terms.includes(requested) ? requested : terms[0];
  if (term === undefined) return <main className={styles.page}><section className={styles.empty}><h2>Agreement data is not loaded yet</h2></section></main>;
  const { matrix, releases } = await load(term, scope);
  const { justices, cells, coverage, coalitions, unusual } = matrix;
  const pickerTerms = terms.slice(0, 30);
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs}><Link href="/">Jurvio</Link> / <Link href={"/justices" as Route}>Justices</Link> / Agreement</nav>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Supreme Court analytics</p>
      <h1>Who votes with whom, {termLabel(term)}</h1>
      <p>Each square shows how often two justices ended up on the same side of a decision in the October {term} Term: both in the majority, or both in dissent. Darker blue means they agreed more often. The small number is how many decisions both took part in, which is what the percentage is out of.</p>
      <ScopeToggle scope={scope} basePath="/justices/agreement" extra={`&term=${term}`} />
      <div className={styles.termPicker} aria-label="Choose a term">{pickerTerms.map((value) => <Link key={value} href={`/justices/agreement?scope=${scope}&term=${value}` as Route} aria-current={value === term ? "page" : undefined}>{value}</Link>)}
        {terms.length > pickerTerms.length ? <span style={{ alignSelf: "center", color: "#6a7489", fontSize: ".8rem" }}>Older terms back to {terms.at(-1)}: add ?term=YYYY</span> : null}</div>
    </header>

    <p><Link className={styles.link} href={`/justices/terms/${term}` as Route}>{termLabel(term)} in numbers: vote splits, every 5–4 decision, opinions and issue areas →</Link></p>

    <section className={styles.section} aria-labelledby="matrix">
      <span className={styles.tag}>Facts from SCDB</span>
      <h2 id="matrix">Agreement matrix</h2>
      <div className={styles.tableWrap}><table className={styles.matrix}>
        <thead><tr><th />{justices.map((justice) => <th key={justice.scdbJusticeId} scope="col"><span>{shortName(justice.displayName)}</span></th>)}</tr></thead>
        <tbody>{justices.map((row) => <tr key={row.scdbJusticeId}>
          <th scope="row" style={{ textAlign: "right" }}><Link className={styles.link} href={`/justices/${row.slug}?scope=${scope}` as Route}>{shortName(row.displayName)}</Link></th>
          {justices.map((col) => {
            if (row.scdbJusticeId === col.scdbJusticeId) return <td key={col.scdbJusticeId} className={styles.self}>—</td>;
            const cell = cells[matrixKey(row.scdbJusticeId, col.scdbJusticeId)];
            const color = agreementColor(cell?.rate ?? null);
            return <td key={col.scdbJusticeId} style={color} title={cell ? `${row.displayName} and ${col.displayName}: same side in ${cell.casesAgreed} of ${cell.casesTogether} decisions (${percent(cell.rate, 1)}); ${cell.casesExcluded} excluded` : "No decisions together"}>
              <strong>{percent(cell?.rate ?? null)}</strong><small>{cell ? `of ${cell.casesTogether}` : ""}</small>
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className={styles.section} aria-labelledby="coalitions">
      <span className={styles.tag}>Facts from SCDB</span>
      <h2 id="coalitions">5–4 coalitions in {termLabel(term)}</h2>
      <p>{coverage?.fiveFourCases ?? 0} decisions this term were 5–4. These are the five-justice majorities that formed, with the SCDB-coded direction of each decision ({SCDB_DIRECTION_LABEL}).</p>
      {coalitions.length ? <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Majority of five</th><th className={styles.num}>Decisions</th><th className={styles.num}>SCDB liberal</th><th className={styles.num}>SCDB conservative</th><th className={styles.num}>Not coded</th></tr></thead>
        <tbody>{coalitions.map((row) => <tr key={row.majority.join()}><td>{row.majority.join(", ")}</td><td className={styles.num}>{row.decisions}</td><td className={styles.num}>{row.liberal}</td><td className={styles.num}>{row.conservative}</td><td className={styles.num}>{row.unspecifiable}</td></tr>)}</tbody>
      </table></div> : <p className={styles.empty}>No 5–4 decisions recorded for this term.</p>}
    </section>

    <section className={styles.section} aria-labelledby="unusual">
      <span className={`${styles.tag} ${styles.tagAnalysis}`}>Jurvio analysis</span>
      <h2 id="unusual">Unusual alignments</h2>
      <aside className={`${styles.explain} ${styles.analysis}`}>
        <p><strong>This list is Jurvio’s analysis, not a fact from SCDB.</strong> The rule is simple and fixed: for each 5–4 decision, find the two justices in the five-justice majority who agreed least often over the whole term, counting every SCDB decision of the term (so the rate can differ slightly from the argued-cases matrix). The lower that pair’s term agreement, the more unusual the coalition. No other weighting is used.</p>
      </aside>
      {unusual.length ? <ul className={styles.caseList}>{unusual.map((row) => <li key={row.scdbCaseId}>
        <h3>{row.jurvioCaseId ? <Link className={styles.link} href={`/case/${row.jurvioCaseId}` as Route}>{row.caseName}</Link> : row.caseName}</h3>
        <p>{row.usCite ?? "no U.S. Reports cite yet"} · decided {row.decidedOn ?? "date unknown"} · SCDB case {row.scdbCaseId}</p>
        <p>{row.pair[0]} and {row.pair[1]} were both in the majority, though they agreed in only {percent(row.pairRate, 1)} of {row.pairCasesTogether} decisions this term. Majority: {row.majority.join(", ")}. Dissent: {row.dissent.join(", ")}.</p>
      </li>)}</ul> : <p className={styles.empty}>No 5–4 decisions to compare this term.</p>}
    </section>

    <EvidenceLedger
      releases={releases.filter((release) => release.sourceSystem.startsWith("scdb"))}
      items={[
        { label: "Term", value: `${termLabel(term)}: ${coverage?.scdbCases ?? 0} SCDB decisions, ${coverage?.arguedCases ?? 0} argued` },
        { label: "Scope", value: scope === "argued" ? "Argued cases (SCDB decision types 1, 6, 7)" : "Every SCDB decision" },
        { label: "Denominator", value: "Decisions in which both justices have an SCDB majority/dissent code" },
        { label: "Excluded", value: "Decisions where either justice did not take part or has no majority/dissent code (shown per cell on hover)" },
        { label: "Linked to Jurvio", value: `${coverage?.casesLinkedToJurvio ?? 0} of ${coverage?.scdbCases ?? 0} decisions this term link to a Jurvio case page` },
      ]}
      coverage={coverage ? { label: "decisions with an SCDB direction code", numerator: coverage.casesWithDirection, denominator: coverage.scdbCases } : null}
      notes={["Agreement counts the side of the final vote only; two justices on the same side may still have written different opinions."]}
    />
  </main>;
}
