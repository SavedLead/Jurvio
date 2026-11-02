import Link from "next/link";
import type { Route } from "next";
import type { CitationReach, CitingCourtKind, SyllabusHolding } from "@/modules/scotus/domain/ramifications";
import styles from "./justices.module.css";

const KIND_LABEL: Record<CitingCourtKind, string> = {
  supreme: "Supreme Court", appellate: "federal appeals courts", district: "federal trial courts", state: "state courts", other: "other courts",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface RamificationsHolding {
  kind: "syllabus" | "verified";
  holding: SyllabusHolding;
  /** Where the quote can be read: our opinion reader or the verified source. */
  readPath: string | null;
  officialUrl: string | null;
}

/**
 * "What this means going forward" on decided Supreme Court cases (free version):
 * the Court's own words for what it decided, and how later cases on Jurvio cite it.
 */
export function CaseRamificationsSection({ holding, reach, citedByCount }: {
  holding: RamificationsHolding | null;
  reach: CitationReach | null;
  citedByCount: number;
}) {
  const total = reach?.total ?? citedByCount;
  const kinds = reach ? (Object.entries(reach.byKind) as Array<[CitingCourtKind, number]>).filter(([, n]) => n > 0) : [];
  return <section className="contentSection caseFeatureSection" aria-labelledby="going-forward" id="going-forward">
    <div className="featureHeading"><div><p className="sectionKicker">Ramifications</p><h2 id="going-forward">What this means going forward</h2></div></div>
    <p style={{ color: "#4b556b", lineHeight: 1.6 }}>A Supreme Court decision becomes <em>precedent</em>: a past decision that courts look to when the same legal question comes up again. Below is what the Court decided, in its own words, and how often later cases cite it.</p>

    <h3 style={{ marginBottom: 4 }}>What the Court decided, in its own words</h3>
    {holding ? <>
      <blockquote className={styles.noteDocket} data-ramifications="holding">
        <small>{holding.kind === "syllabus" ? "From the syllabus (“Held:”)" : "The holding, quoted from the Court"}</small>“{holding.holding.text}”{holding.holding.truncated ? " …" : ""}
      </blockquote>
      <p style={{ color: "#5f6980", fontSize: ".85rem", lineHeight: 1.55, margin: "6px 0 0" }}>
        {holding.kind === "syllabus" ? "The syllabus is a summary the Court’s Reporter of Decisions prepares for readers; it is not part of the opinion itself. " : null}
        {holding.readPath ? <Link className={styles.link} href={holding.readPath as Route}>Read it in the opinion →</Link> : null}
        {holding.readPath && holding.officialUrl ? " · " : null}
        {holding.officialUrl ? <a className={styles.link} href={holding.officialUrl} rel="nofollow noopener">Official source →</a> : null}
      </p>
    </> : <p style={{ color: "#5f6980" }}>The records we have don’t include the Court’s syllabus or a verified holding for this decision, so we don’t quote one here.</p>}

    {/* AI_IMPACT_SUMMARY_SLOT: a plain-English impact summary (what changed, who it affects) would go here.
        It needs a paid AI/LLM step and David's OK, so it is intentionally not built. */}
    <div data-ai-impact-slot="not-built" hidden />

    <h3 style={{ marginBottom: 4, marginTop: 18 }}>How later cases use it</h3>
    {total > 0 ? <>
      <p style={{ lineHeight: 1.6, margin: "0 0 6px" }} data-ramifications="reach">
        <strong>{total.toLocaleString("en-US")} later {total === 1 ? "case" : "cases"}</strong> on Jurvio {total === 1 ? "cites" : "cite"} this decision
        {reach && reach.lastFiveYears > 0 && total > 1 ? <>, {reach.lastFiveYears === total ? "all" : reach.lastFiveYears.toLocaleString("en-US")} of them in the last five years</> : null}
        {reach?.firstCitedOn && reach.lastCitedOn
          ? formatDate(reach.firstCitedOn) === formatDate(reach.lastCitedOn) ? <> (in {formatDate(reach.lastCitedOn)})</> : <> (from {formatDate(reach.firstCitedOn)} to {formatDate(reach.lastCitedOn)})</>
          : null}.
        {kinds.length ? <> By court: {kinds.map(([kind, n], index) => <span key={kind}>{index ? ", " : ""}{n.toLocaleString("en-US")} in {KIND_LABEL[kind]}</span>)}.</> : null}
      </p>
      {reach?.topCourts.length ? <>
        <p style={{ margin: "8px 0 0", color: "#5f6980", fontSize: ".85rem", fontWeight: 700 }}>Courts that cite it most</p>
        <ol className={styles.caseList} data-ramifications="top-courts">
          {reach.topCourts.map((row) => <li key={row.courtPublicId ?? row.courtName} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{row.courtPublicId ? <Link className={styles.link} href={`/courts/${row.courtPublicId}` as Route}>{row.courtName}</Link> : row.courtName}</span>
            <strong>{row.cases.toLocaleString("en-US")}</strong>
          </li>)}
        </ol>
      </> : null}
      <p style={{ color: "#5f6980", fontSize: ".85rem", lineHeight: 1.55 }}>
        Counts include only cases Jurvio holds, so the real number of citing cases is likely higher. A citation shows a later court mentioned this decision; it does not by itself say whether that court followed it. <a className={styles.link} href="#cited-by">See the citing cases →</a>
      </p>
    </> : <p style={{ color: "#5f6980" }}>We don’t have any later cases citing this decision yet.</p>}
  </section>;
}
