import Link from "next/link";
import type { Metadata, Route } from "next";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { listDatasetReleases, listJustices, listTermCoverage, parseScope, type JusticeScope, type JusticeSummary } from "@/modules/scotus/application/justice-analytics";
import { percent, termLabel } from "@/modules/scotus/domain/justice-lineup";
import { DirectionExplainer, EvidenceLedger, ScopeToggle, SCDB_DIRECTION_LABEL } from "@/modules/scotus/ui/justice-ui";
import styles from "@/modules/scotus/ui/justices.module.css";

export const dynamic = "force-dynamic";

const load = unstable_cache(
  async (scope: JusticeScope) => {
    const sql = db();
    const [justices, releases, coverage] = await Promise.all([listJustices(sql, scope), listDatasetReleases(sql), listTermCoverage(sql)]);
    return { justices, releases, coverage };
  },
  ["public-justices-index-v1"],
  { revalidate: 3600, tags: ["public-justices"] },
);

export const metadata: Metadata = {
  title: "Supreme Court Justices: Voting Records and Analytics",
  description: "Every Supreme Court justice’s votes from the Supreme Court Database: SCDB-coded liberal/conservative share, Martin-Quinn scores, agreement rates and 5–4 coalitions, with every denominator shown.",
  alternates: { canonical: "/justices" },
};

type Params = { scope?: string | string[] };

function JusticeCard({ justice }: { justice: JusticeSummary }) {
  const d = justice.direction;
  return <li><Link className={styles.card} href={`/justices/${justice.slug}` as Route}>
    <h3>{justice.displayName}</h3>
    <p>{justice.appointmentTitle ?? "Justice"}{justice.appointingPresident ? `, appointed by ${justice.appointingPresident}` : ""}
      {justice.firstTerm !== null ? ` · terms ${justice.firstTerm}–${justice.serviceEnd ? justice.lastTerm : "present"}` : ""}</p>
    <dl>
      <div><dt>Votes on record</dt><dd>{(d?.votesParticipating ?? 0).toLocaleString()}</dd></div>
      <div><dt>SCDB-coded liberal</dt><dd>{d ? `${percent(d.liberal.rate)} (${d.liberal.numerator.toLocaleString()} of ${d.liberal.denominator.toLocaleString()})` : "—"}</dd></div>
      <div><dt>Martin-Quinn (latest)</dt><dd>{justice.latestMartinQuinn ? `${justice.latestMartinQuinn.mean.toFixed(2)} in ${termLabel(justice.latestMartinQuinn.term)}` : "not published"}</dd></div>
    </dl>
  </Link></li>;
}

export default async function JusticesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const scope = parseScope((await searchParams).scope);
  const { justices, releases, coverage } = await load(scope);
  const current = justices.filter((justice) => !justice.serviceEnd);
  const former = justices.filter((justice) => justice.serviceEnd);
  const latest = coverage[0] ?? null;
  const totalCases = coverage.reduce((sum, row) => sum + row.scdbCases, 0);
  const withDirection = coverage.reduce((sum, row) => sum + row.casesWithDirection, 0);
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs}><Link href="/">Jurvio</Link> / <Link href={"/supreme-court" as Route}>Supreme Court</Link> / Justices</nav>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Supreme Court analytics</p>
      <h1>The justices and how they vote</h1>
      <p>Every vote cast by every Supreme Court justice since 1791, as recorded by the Supreme Court Database. Each number shows what it was counted out of, what was left out, and where the data came from. Nothing here is a Jurvio score.</p>
      <ScopeToggle scope={scope} basePath="/justices" />
    </header>
    <DirectionExplainer />
    <p><Link className={styles.link} href={`/justices/agreement?scope=${scope}` as Route}>See how often each pair of justices votes together →</Link></p>
    {justices.length ? <>
      <section className={styles.section} aria-labelledby="current">
        <h2 id="current">The current Court</h2>
        <p>Percentages are each justice’s whole career in this scope: votes the SCDB coded liberal, out of votes it gave a direction. Ties and uncodable votes are excluded and counted in the ledger on each profile.</p>
        <ul className={styles.grid}>{current.map((justice) => <JusticeCard key={justice.scdbJusticeId} justice={justice} />)}</ul>
      </section>
      <section className={styles.section} aria-labelledby="former">
        <h2 id="former">All former justices</h2>
        <ul className={styles.grid}>{former.map((justice) => <JusticeCard key={justice.scdbJusticeId} justice={justice} />)}</ul>
      </section>
    </> : <section className={styles.empty}><h2>Justice data is not loaded yet</h2><p>The Supreme Court Database import has not run on this server.</p></section>}
    <EvidenceLedger
      releases={releases}
      items={[
        { label: "Justices", value: `${justices.length.toLocaleString()} (SCDB roster, matched to the Federal Judicial Center by FJC id)` },
        { label: "Decisions", value: `${totalCases.toLocaleString()} SCDB decisions, terms ${coverage.at(-1)?.term ?? "—"}–${latest?.term ?? "—"}` },
        { label: "Scope", value: scope === "argued" ? "Argued cases: SCDB decision types 1 (opinion of the Court), 6 (orally argued per curiam) and 7 (judgment of the Court)" : "Every SCDB decision, including memorandum and unargued per curiam decisions" },
        { label: "Labels", value: `Direction is ${SCDB_DIRECTION_LABEL}; Jurvio does not label justices by party.` },
      ]}
      coverage={{ label: "decisions with an SCDB direction code", numerator: withDirection, denominator: totalCases }}
      notes={[
        latest ? `Most recent term held: ${termLabel(latest.term)} (${latest.scdbCases} decisions, SCDB ${latest.scdbVersion ?? "release unknown"}). Martin-Quinn scores exist for ${latest.martinQuinnJustices} justices that term.` : "No term loaded.",
        "Pre-1946 decisions come from the SCDB Legacy release; 25 Legacy vote rows with an unidentified justice (SCDB code -99) are left out.",
      ]}
    />
  </main>;
}
