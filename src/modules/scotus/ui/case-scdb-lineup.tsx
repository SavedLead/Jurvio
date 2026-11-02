import Link from "next/link";
import type { Route } from "next";
import type { CaseLineup } from "@/modules/scotus/application/justice-analytics";
import { lineupRole, termLabel } from "@/modules/scotus/domain/justice-lineup";
import { SCDB_DIRECTION_DOC, SCDB_DIRECTION_LABEL, SCDB_HOME } from "./justice-ui";
import styles from "./justices.module.css";

const MATCH_LABEL: Record<string, string> = {
  us_cite: "the U.S. Reports citation",
  docket_and_date: "the docket number and decision date",
  docket_and_term: "the docket number and term",
};

/** The SCDB vote and justice lineup on a SCOTUS case page. Facts only; every label is an SCDB code. */
export function CaseScdbLineup({ lineup }: { lineup: CaseLineup }) {
  const majority = lineup.votes.filter((vote) => vote.side === "majority");
  const dissent = lineup.votes.filter((vote) => vote.side === "dissent");
  const other = lineup.votes.filter((vote) => vote.side === "not recorded");
  const author = lineup.votes.find((vote) => vote.wroteMajorityOpinion);
  const concurring = majority.filter((vote) => vote.vote === 3 || vote.vote === 4);
  const item = (vote: CaseLineup["votes"][number]) => <li key={vote.scdbJusticeId} className={`${vote.side === "dissent" ? styles.lineupDissent : styles.lineupMajority} ${vote.wroteMajorityOpinion ? styles.lineupAuthor : ""}`}>
    <strong>{vote.slug ? <Link className={styles.link} href={`/justices/${vote.slug}` as Route}>{vote.name}</Link> : vote.name}</strong>
    <span>{lineupRole(vote)}{vote.scdbDirectionLabel ? ` · vote coded ${vote.scdbDirectionLabel}` : ""}</span>
  </li>;
  return <section className="contentSection caseFeatureSection" aria-labelledby="scdb-lineup">
    <div className="featureHeading decisionHeading">
      <h2 id="scdb-lineup">How the justices voted</h2>
      {lineup.voteSplit ? <strong className="decisionLabel">{lineup.voteSplit}</strong> : null}
    </div>
    <p style={{ color: "#4b556b", lineHeight: 1.6 }}>
      {author ? <>Opinion of the Court by <strong>{author.name}</strong>. </> : lineup.majorityOpinionWriter ? <>Opinion of the Court by <strong>{lineup.majorityOpinionWriter}</strong>. </> : null}
      {majority.length} in the majority{concurring.length ? ` (${concurring.length} also concurring)` : ""}, {dissent.length} dissenting{other.length ? `, ${other.length} with no recorded vote` : ""}.
    </p>
    <h3 style={{ marginBottom: 0 }}>Majority</h3>
    <ul className={styles.lineup}>{majority.map(item)}</ul>
    {dissent.length ? <><h3 style={{ marginBottom: 0 }}>Dissent</h3><ul className={styles.lineup}>{dissent.map(item)}</ul></> : null}
    {other.length ? <><h3 style={{ marginBottom: 0 }}>No recorded vote</h3><ul className={styles.lineup}>{other.map(item)}</ul></> : null}
    <aside className={styles.explain}>
      <p><strong>Reading this:</strong> the majority decides the case; a concurrence agrees with the result but adds or changes the reasoning; a dissent disagrees with the result. “Coded liberal/conservative” is the {SCDB_DIRECTION_LABEL}, applying its published rules to the side each justice voted for, not a statement about party. <a className={styles.link} href={SCDB_DIRECTION_DOC} rel="noopener">How SCDB codes direction →</a></p>
    </aside>
    <details className={styles.ledger}>
      <summary>Evidence ledger</summary>
      <dl>
        <div style={{ display: "contents" }}><dt>Source</dt><dd><a className={styles.link} href={SCDB_HOME} rel="noopener">Supreme Court Database</a>{lineup.scdbVersion ? `, ${lineup.scdbVersion}` : ""}, case {lineup.scdbCaseId} ({termLabel(lineup.term)})</dd></div>
        <div style={{ display: "contents" }}><dt>Linked by</dt><dd>{MATCH_LABEL[lineup.matchMethod ?? ""] ?? "unknown"}{lineup.usCite ? ` (${lineup.usCite})` : ""}{lineup.docket ? `, docket ${lineup.docket}` : ""}; ambiguous matches are never linked</dd></div>
        <div style={{ display: "contents" }}><dt>Decision</dt><dd>{lineup.decisionTypeLabel ?? "type not coded"}{lineup.issueAreaLabel ? ` · issue area: ${lineup.issueAreaLabel}` : ""} · SCDB direction: {lineup.scdbDecisionDirectionLabel ?? "not coded"}</dd></div>
        <div style={{ display: "contents" }}><dt>Votes</dt><dd>{lineup.votes.length} justice rows: {majority.length} majority, {dissent.length} dissent, {other.length} not recorded</dd></div>
      </dl>
    </details>
  </section>;
}
