import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { listDatasetReleases, loadJusticeProfile, parseScope, type JusticeScope } from "@/modules/scotus/application/justice-analytics";
import { percent, shortName, termLabel } from "@/modules/scotus/domain/justice-lineup";
import {
  DirectionExplainer, EvidenceLedger, MartinQuinnChart, MartinQuinnExplainer, ScopeToggle, ShareBar, ShareByTermChart, SCDB_DIRECTION_LABEL,
} from "@/modules/scotus/ui/justice-ui";
import styles from "@/modules/scotus/ui/justices.module.css";

export const dynamic = "force-dynamic";

const load = unstable_cache(
  async (slug: string, scope: JusticeScope) => {
    const sql = db();
    const [profile, releases] = await Promise.all([loadJusticeProfile(sql, slug, scope), listDatasetReleases(sql)]);
    return { profile, releases };
  },
  ["public-justice-profile-v1"],
  { revalidate: 3600, tags: ["public-justices"] },
);

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ scope?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { profile } = await load(slug, "argued");
  if (!profile) return { title: "Justice not found" };
  const name = profile.justice.displayName;
  return {
    title: `${name}: Supreme Court Voting Record`,
    description: `${name}’s votes from the Supreme Court Database: SCDB-coded liberal/conservative share by term and issue, Martin-Quinn scores, agreement with other justices and 5–4 decisions.`,
    alternates: { canonical: `/justices/${slug}` },
  };
}

export default async function JusticePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const scope = parseScope((await searchParams).scope);
  const { profile, releases } = await load(slug, scope);
  if (!profile) notFound();
  const { justice, terms, issues, pairs, fiveFour } = profile;
  const d = justice.direction;
  const termsWithMq = terms.filter((term) => term.martinQuinn).map((term) => ({ term: term.term, ...term.martinQuinn! }));
  const sharePoints = terms.map((term) => ({
    term: term.term,
    numerator: term.direction?.liberal.numerator ?? 0,
    denominator: term.direction?.liberal.denominator ?? 0,
    rate: term.direction?.liberal.rate ?? null,
  }));
  const totals = terms.reduce((sum, term) => ({
    majority: sum.majority + term.votesInMajority, dissent: sum.dissent + term.votesInDissent,
    participating: sum.participating + term.votesParticipating, opinions: sum.opinions + term.opinionsWritten, majorityOpinions: sum.majorityOpinions + term.majorityOpinionsWritten,
  }), { majority: 0, dissent: 0, participating: 0, opinions: 0, majorityOpinions: 0 });
  const scdbReleases = releases.filter((release) => release.sourceSystem.startsWith("scdb"));
  const scopeName = scope === "argued" ? "argued cases" : "all SCDB decisions";
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs}><Link href="/">Jurvio</Link> / <Link href={"/justices" as Route}>Justices</Link> / {justice.displayName}</nav>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Supreme Court justice</p>
      <h1>{justice.displayName}</h1>
      <p>{justice.appointmentTitle ?? "Justice"}{justice.appointingPresident ? `, appointed by President ${justice.appointingPresident}` : ""}. Served {justice.serviceStart ?? "?"} to {justice.serviceEnd ?? "present"}
        {justice.firstTerm !== null ? ` (SCDB terms ${justice.firstTerm}–${justice.lastTerm})` : ""}.
        {justice.bioSourceUrl ? <> <a className={styles.link} href={justice.bioSourceUrl} rel="noopener">Federal Judicial Center biography →</a></> : null}</p>
      <ScopeToggle scope={scope} basePath={`/justices/${slug}`} />
    </header>

    <section aria-label="Career summary">
      <span className={styles.tag}>Facts from SCDB</span>
      <dl className={styles.facts}>
        <div><dt>Votes cast ({scopeName})</dt><dd>{(d?.votesParticipating ?? 0).toLocaleString()}<small>{(d?.rowsOnRecord ?? 0).toLocaleString()} decisions on record; {((d?.rowsOnRecord ?? 0) - (d?.votesParticipating ?? 0)).toLocaleString()} without a recorded vote</small></dd></div>
        <div><dt>SCDB-coded liberal votes</dt><dd>{d ? percent(d.liberal.rate, 1) : "—"}<small>{d ? `${d.liberal.numerator.toLocaleString()} of ${d.liberal.denominator.toLocaleString()} votes with a direction; ${d.votesWithoutDirection.toLocaleString()} had none` : ""}</small></dd></div>
        <div><dt>Votes in the majority / dissent</dt><dd>{totals.majority.toLocaleString()} / {totals.dissent.toLocaleString()}<small>all SCDB decisions; {(totals.participating - totals.majority - totals.dissent).toLocaleString()} of {totals.participating.toLocaleString()} votes have no majority/dissent code</small></dd></div>
        <div><dt>Opinions written</dt><dd>{totals.opinions.toLocaleString()}<small>{totals.majorityOpinions.toLocaleString()} for the Court (SCDB majority-opinion writer)</small></dd></div>
      </dl>
    </section>

    <section className={styles.section} aria-labelledby="by-term">
      <h2 id="by-term">SCDB-coded liberal share, term by term</h2>
      <p>Each dot is one term: the share of {shortName(justice.displayName)}’s votes that the Supreme Court Database coded liberal, out of votes it gave a direction. Hollow dots mark terms with fewer than 20 such votes, where one or two cases move the number a lot. Hover a dot for its count. The dashed line is 50%.</p>
      <ShareByTermChart points={sharePoints} label={`${justice.displayName}: share of votes ${SCDB_DIRECTION_LABEL}, by term`} />
      <DirectionExplainer />
    </section>

    <section className={styles.section} aria-labelledby="mq">
      <h2 id="mq">Martin-Quinn score over time</h2>
      <MartinQuinnChart points={termsWithMq} label={`${justice.displayName}: Martin-Quinn ideal point by term with 95% interval`} />
      <MartinQuinnExplainer />
    </section>

    <section className={styles.section} aria-labelledby="issues">
      <h2 id="issues">By issue area</h2>
      <p>The same SCDB-coded share, split by SCDB’s 14 issue areas across the whole career. The bar is the liberal share; the rest is conservative.</p>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Issue area (SCDB)</th><th className={styles.num}>Votes with a direction</th><th className={styles.num}>Coded liberal</th><th className={styles.num}>Share</th><th>Liberal ← → conservative</th><th className={styles.num}>No direction</th></tr></thead>
        <tbody>{issues.map((issue) => <tr key={issue.issueArea}>
          <td>{issue.label}</td><td className={styles.num}>{issue.direction.votesWithDirection.toLocaleString()}</td>
          <td className={styles.num}>{issue.direction.liberal.numerator.toLocaleString()}</td>
          <td className={styles.num}>{percent(issue.direction.liberal.rate)}</td><td><ShareBar rate={issue.direction.liberal.rate} /></td>
          <td className={styles.num}>{issue.direction.votesWithoutDirection.toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className={styles.section} aria-labelledby="pairs">
      <h2 id="pairs">Who {shortName(justice.displayName)} votes with</h2>
      <p>Agreement = the share of decisions both justices took part in where they landed on the same side (majority or dissent), using SCDB’s majority/dissent code. Decisions where either vote has no side are excluded and counted.</p>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Justice</th><th className={styles.num}>Same side</th><th className={styles.num}>Decisions together</th><th className={styles.num}>Agreement</th><th className={styles.num}>Excluded</th></tr></thead>
        <tbody>{pairs.map((pair) => <tr key={pair.otherJusticeId}>
          <td><Link className={styles.link} href={`/justices/${pair.otherSlug}?scope=${scope}` as Route}>{pair.otherName}</Link></td>
          <td className={styles.num}>{pair.casesAgreed.toLocaleString()}</td><td className={styles.num}>{pair.casesTogether.toLocaleString()}</td>
          <td className={styles.num}>{percent(pair.rate, 1)}</td><td className={styles.num}>{pair.casesExcluded.toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>
      <p><Link className={styles.link} href={`/justices/agreement?scope=${scope}${justice.lastTerm ? `&term=${justice.lastTerm}` : ""}` as Route}>Full agreement matrix for {justice.lastTerm ? termLabel(justice.lastTerm) : "a term"} →</Link></p>
    </section>

    <section className={styles.section} aria-labelledby="five-four">
      <h2 id="five-four">5–4 decisions</h2>
      <p>Decisions SCDB records as five votes to four. {shortName(justice.displayName)} was in {fiveFour.total.toLocaleString()} of them: {fiveFour.inMajority.toLocaleString()} in the majority and {fiveFour.inDissent.toLocaleString()} in dissent. Most recent:</p>
      <ul className={styles.caseList}>{fiveFour.recent.map((row) => <li key={row.scdbCaseId}>
        <h3>{row.jurvioCaseId ? <Link className={styles.link} href={`/case/${row.jurvioCaseId}` as Route}>{row.caseName}</Link> : row.caseName}</h3>
        <p>{row.usCite ?? "no U.S. Reports cite yet"} · decided {row.decidedOn ?? "date unknown"} · {row.side === "majority" ? "in the majority" : "in dissent"} · SCDB direction: {row.scdbDirection ?? "not coded"}{row.issueArea ? ` · ${row.issueArea}` : ""}</p>
        <p>Majority: {row.majority.join(", ")}. Dissent: {row.dissent.join(", ")}.</p>
      </li>)}</ul>
    </section>

    <EvidenceLedger
      releases={releases}
      items={[
        { label: "Justice", value: `SCDB justice ${justice.scdbJusticeId} (${justice.scdbCode}); biography from the Federal Judicial Center` },
        { label: "Scope", value: scope === "argued" ? "Argued cases (SCDB decision types 1, 6, 7)" : "Every SCDB decision" },
        { label: "Decisions on record", value: (d?.rowsOnRecord ?? 0).toLocaleString() },
        { label: "Votes cast", value: (d?.votesParticipating ?? 0).toLocaleString() },
        { label: "Unknown direction", value: `${(d?.votesWithoutDirection ?? 0).toLocaleString()} votes (SCDB direction missing or unspecifiable), excluded from shares` },
        { label: "Martin-Quinn terms", value: `${termsWithMq.length} of ${terms.length} terms (published scores cover OT1937 onward; the current release ends at OT2024)` },
      ]}
      coverage={d ? { label: "votes with an SCDB direction code", numerator: d.votesWithDirection, denominator: d.votesParticipating } : null}
      notes={[
        "Majority/dissent, opinion authorship and direction are SCDB’s codes, not Jurvio’s reading of the opinions.",
        `Data versions: ${scdbReleases.map((release) => release.version).join(", ") || "not loaded"}.`,
      ]}
    />
  </main>;
}
