import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import { db } from "@/db/client";
import { calculateOutcomeRates, getPublicJudge } from "@/modules/judges/application/public-judge-analytics";
import directory from "@/modules/directory/ui/directory.module.css";
import styles from "@/modules/judges/ui/judge-analytics.module.css";
import { robotsFor } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }): Promise<Metadata> {
  const { publicId } = await params;
  const judge = await getPublicJudge(db(), publicId);
  if (!judge) return { title: "Judge profile not found", robots: { index: false, follow: false } };
  return {
    title: `${judge.displayName} — Federal Judge Analytics`,
    description: `Source-backed case volume, outcomes, case mix, timing, awards, and recent federal cases for ${judge.displayName}.`,
    alternates: { canonical: `/judges/${publicId}` },
    robots: robotsFor(judge.indexable),
  };
}

function money(value: number | null) {
  return value === null ? "Not enough data" : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(value);
}

export default async function JudgePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const judge = await getPublicJudge(db(), publicId);
  if (!judge) notFound();
  const rates = calculateOutcomeRates(judge);
  const maxNos = Math.max(...judge.natureOfSuit.map((item) => item.caseCount), 1);

  return <main className={directory.page}>
    <nav className={directory.breadcrumbs}><Link href="/judges">Judges</Link> / {judge.displayName}</nav>
    <header className={directory.profileHeader}>
      <p className={directory.eyebrow}>Source-backed federal judge analytics</p>
      <h1>{judge.displayName}</h1>
      <p>{judge.courtName ?? "Court information unavailable"}. Statistics describe the verified public records Jurvio currently covers, not every matter ever handled by the judge.</p>
      <dl className={directory.facts}>
        <div><dt>Public cases</dt><dd>{judge.caseCount.toLocaleString()}</dd></div>
        <div><dt>Classified outcomes</dt><dd>{rates.sample.toLocaleString()}</dd></div>
        <div><dt>Awards measured</dt><dd>{judge.awardSample.toLocaleString()}</dd></div>
        <div><dt>Data status</dt><dd>Verified sources</dd></div>
      </dl>
    </header>

    <section className={directory.section}><h2>Case outcomes</h2>
      <p className={styles.small}>Percentages use only high-confidence, source-linked final outcome observations. Mixed rulings are kept separate.</p>
      <div className={styles.grid}>
        <div className={styles.stat}><span>Plaintiff-favorable</span><strong>{rates.plaintiffPercent === null ? "N/A" : `${rates.plaintiffPercent}%`}</strong></div>
        <div className={styles.stat}><span>Defendant-favorable</span><strong>{rates.defendantPercent === null ? "N/A" : `${rates.defendantPercent}%`}</strong></div>
        <div className={styles.stat}><span>Mixed outcomes</span><strong>{rates.mixedPercent === null ? "N/A" : `${rates.mixedPercent}%`}</strong></div>
      </div>
    </section>

    <section className={directory.section}><h2>Case mix by nature of suit</h2>
      {judge.natureOfSuit.length ? <ol className={styles.barList}>{judge.natureOfSuit.map((item) =>
        <li key={item.code}><span>{item.code}</span><div className={styles.bar}><div className={styles.fill} style={{ width: `${Math.max(3, item.caseCount / maxNos * 100)}%` }} /></div><strong>{item.caseCount.toLocaleString()}</strong></li>
      )}</ol> : <p>Not enough classified cases are available yet.</p>}
    </section>

    <section className={directory.section}><h2>Timing and monetary awards</h2>
      <div className={styles.grid}>
        <div className={styles.stat}><span>Average major-ruling time</span><strong>{judge.averageDaysToMajorRuling === null ? "Not enough data" : `${Math.round(judge.averageDaysToMajorRuling)} days`}</strong><span>{judge.rulingTimeSample} measured rulings</span></div>
        <div className={styles.stat}><span>Median monetary award</span><strong>{money(judge.medianAward)}</strong><span>{judge.awardSample} sourced awards</span></div>
        <div className={styles.stat}><span>Average monetary award</span><strong>{money(judge.averageAward)}</strong><span>Excludes requested amounts and unsupported figures</span></div>
      </div>
    </section>

    <section className={directory.section}><h2>Recent public cases</h2>
      <ol className={directory.caseList}>{judge.recentCases.map((record) => <li key={record.publicId}>
        <Link href={`/case/${record.publicId}` as Route}><div><h3>{record.caption}</h3><p>{record.courtName} · {record.docketNumber}</p></div><time>{record.filedOn ?? "Date unavailable"}</time></Link>
      </li>)}</ol>
    </section>

    <aside className={styles.method}><strong>How to read these statistics:</strong> An assignment does not imply the judge personally decided every event. Outcome direction is descriptive, not a prediction or an assessment of judicial quality. Jurvio excludes unverified identity matches and shows sample sizes so incomplete coverage is visible.</aside>
  </main>;
}
