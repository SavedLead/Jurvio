import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { CaseJusticeNotes } from "@/modules/scotus/application/justice-notes";
import type { CaseLineup } from "@/modules/scotus/application/justice-analytics";
import type { JusticeNoteContext, JusticeNoteKind } from "@/modules/scotus/domain/docket-justice-notes";
import { lineupRole, termLabel } from "@/modules/scotus/domain/justice-lineup";
import { benchChips, CHIP_LABEL, groupVoteNotes, publicNames, shortName, voteSummaryLine, type NoteGroup, type VoteNote } from "@/modules/scotus/domain/justice-vote-summary";
import { noteLabel, RULE_OF_FOUR_SOURCE } from "./case-justice-notes";
import { SCDB_DIRECTION_DOC, SCDB_DIRECTION_LABEL, SCDB_HOME } from "./justice-ui";
import styles from "./justices-voted.module.css";

const ORDER_LABEL: Record<JusticeNoteContext, string> = {
  cert_denied: "The Court declined to hear the case",
  cert_granted: "The Court agreed to take the case",
  application: "The Court ruled on an application (a request made outside the normal schedule, often an emergency)",
  rehearing: "The Court ruled on a request to reconsider (a petition for rehearing)",
  other: "A Court order",
};

const MATCH_LABEL: Record<string, string> = {
  us_cite: "the U.S. Reports citation",
  docket_and_date: "the docket number and decision date",
  docket_and_term: "the docket number and term",
};

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function writingWord(kind: JusticeNoteKind): string {
  return kind === "statement" ? "statement" : kind === "concurrence" ? "concurring opinion" : "dissent";
}

function JusticeName({ note }: { note: Pick<VoteNote, "name" | "slug"> }) {
  return note.slug ? <Link className={styles.link} href={`/justices/${note.slug}` as Route}>{note.name}</Link> : <>{note.name}</>;
}

function OrderBlock({ group, bench, docketUrl, docketNumber, primary }: { group: NoteGroup; bench: CaseJusticeNotes["bench"]; docketUrl: string; docketNumber: string; primary: boolean }) {
  const chips = primary && bench.length ? benchChips(group, bench) : [];
  const entryText = group.entryText.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  const everyone = [...group.written.flatMap((opinion) => [opinion.author, ...opinion.joiners]), ...group.positions];
  const denial = group.context === "cert_denied";
  return <div className={styles.root} data-order={group.context}>
    {primary ? null : <h3 className={styles.earlier}>Earlier order</h3>}
    <p className={styles.order}>{ORDER_LABEL[group.context]} · <time dateTime={group.entryOn}>{formatDate(group.entryOn)}</time></p>
    <p className={styles.lead} data-vote-summary="">{voteSummaryLine(group, primary && bench.length ? bench.length : null)}</p>
    {chips.length ? <ul className={styles.chips} aria-label="Each justice's public position on this order">
      {chips.map((chip) => <li key={chip.name} className={styles.chip} data-status={chip.status}>
        <span className={styles.chipName}>{chip.surname}</span>
        <span className={styles.chipStatus}>{CHIP_LABEL[chip.status]}</span>
      </li>)}
    </ul> : null}
    {group.written.length ? <ul className={styles.opinions}>
      {group.written.map((opinion) => <li key={`${opinion.author.justiceRef}:${opinion.author.kind}`} className={styles.opinion} data-kind={opinion.author.kind}>
        <p className={styles.opinionWho}><JusticeName note={opinion.author} />{opinion.joiners.length ? <>, joined by {opinion.joiners.map((joiner, index) => <span key={joiner.justiceRef}>{index ? (index === opinion.joiners.length - 1 ? " and " : ", ") : ""}<JusticeName note={joiner} /></span>)}</> : null}</p>
        <p className={styles.opinionWhat}>{noteLabel(opinion.author.kind, opinion.author.context)}</p>
        {opinion.author.opinionReason ? <p className={styles.why}><span className={styles.whyLabel}>In {shortName(opinion.author)}’s words, why:</span>“{opinion.author.opinionReason}”</p> : null}
        {opinion.author.opinionUrl ? <a className={styles.pdf} href={opinion.author.opinionUrl} rel="noopener">Read the full {writingWord(opinion.author.kind)} (official PDF) →</a> : null}
      </li>)}
    </ul> : null}
    <details className={styles.more}>
      <summary>More detail</summary>
      <div className={styles.moreBody}>
        {group.written.filter((opinion) => opinion.author.opinionOpening).map((opinion) => <blockquote key={`open-${opinion.author.justiceRef}`}>
          <small>How {shortName(opinion.author)}’s {writingWord(opinion.author.kind)} begins:</small>“{opinion.author.opinionOpening}”
        </blockquote>)}
        <ul className={styles.moreList} aria-label="Each public position, as the docket states it">
          {everyone.map((note) => <li key={`${note.justiceRef}:${note.kind}`}>
            <JusticeName note={note} />: {noteLabel(note.kind, note.context)}
            {note.opinionUrl && note.kind.startsWith("joined_") ? <> · <a className={styles.link} href={note.opinionUrl} rel="noopener">the opinion they joined (official PDF)</a></> : null}
          </li>)}
        </ul>
        <blockquote><small>The Court’s docket entry, word for word:</small>“{entryText}” <a className={styles.link} href={docketUrl} rel="noopener">Official docket, No. {docketNumber} →</a></blockquote>
        {denial
          ? <p>When the Court turns a case away (denies <em>certiorari</em>, the request to review a lower court’s decision), it usually does not say how each justice voted. The docket names only the justices who chose to make their position public, and that is all we show here. <strong>The other justices’ votes are not made public.</strong></p>
          : <p>These are the positions individual justices chose to put on the Court’s docket when it acted. The Court does not publish the other justices’ votes on these orders.</p>}
        <p><strong>Reading this:</strong> a <em>dissent</em> means the justice disagreed with what the Court did; a <em>statement</em> explains a justice’s view without necessarily disagreeing; “would grant” means the justice would have taken the case. Taking a case needs four of the nine justices to vote yes (the “Rule of Four”; <a className={styles.link} href={RULE_OF_FOUR_SOURCE} rel="noopener">Supreme Court explainer, PDF</a>), so when a case is turned away we know fewer than four voted to hear it, but not who.</p>
        {group.written.some((opinion) => opinion.author.opinionOpening || opinion.author.opinionReason)
          ? <p>Quotes are the opening lines of the justice’s own writing and, where one is found by a fixed rule, the sentence where they say why. They are not a summary written by Jurvio.</p> : null}
      </div>
    </details>
  </div>;
}

function LineupBlock({ lineup, extra }: { lineup: CaseLineup; extra?: ReactNode }) {
  const majority = lineup.votes.filter((vote) => vote.side === "majority");
  const dissent = lineup.votes.filter((vote) => vote.side === "dissent");
  const other = lineup.votes.filter((vote) => vote.side === "not recorded");
  const author = lineup.votes.find((vote) => vote.wroteMajorityOpinion);
  const concurring = majority.filter((vote) => vote.vote === 3 || vote.vote === 4);
  const surname = (name: string) => name.replace(/,?\s+Jr\.$/, "").split(/\s+/).at(-1) ?? name;
  const dissentWriters = dissent.filter((vote) => vote.opinion === 2 || vote.opinion === 3);
  const lead = [
    lineup.voteSplit ? `${lineup.voteSplit.replace("-", "–")}.` : null,
    author ? `${surname(author.name)} wrote the Court’s opinion.` : lineup.majorityOpinionWriter ? `${lineup.majorityOpinionWriter} wrote the Court’s opinion.` : null,
    dissent.length ? (dissentWriters.length === 1
      ? `${surname(dissentWriters[0]!.name)} wrote the dissent${dissent.length > 1 ? `; ${dissent.filter((vote) => vote !== dissentWriters[0]).map((vote) => surname(vote.name)).join(", ")} also dissented` : ""}.`
      : `${dissent.map((vote) => surname(vote.name)).join(", ")} dissented.`) : "No justice dissented.",
    concurring.length ? `${concurring.length} in the majority also concurred.` : null,
    other.length ? `${other.length} with no recorded vote.` : null,
  ].filter(Boolean).join(" ");
  const status = (vote: CaseLineup["votes"][number]) => vote.wroteMajorityOpinion ? "wrote" : vote.side === "dissent" ? "dissent" : vote.side === "majority" ? "majority" : "not-public";
  const statusLabel = { wrote: "Wrote for the Court", dissent: "Dissented", majority: "Majority", "not-public": "Not recorded" } as const;
  return <div className={styles.root} data-order="decision">
    <p className={styles.order}>The Court decided the case{lineup.usCite ? ` · ${lineup.usCite}` : ""}</p>
    <p className={styles.lead} data-vote-summary="">{lead}</p>
    <ul className={styles.chips} aria-label="Each justice's vote">
      {lineup.votes.map((vote) => <li key={vote.scdbJusticeId} className={styles.chip} data-status={status(vote)}>
        <span className={styles.chipName}>{surname(vote.name)}</span>
        <span className={styles.chipStatus}>{statusLabel[status(vote)]}</span>
      </li>)}
    </ul>
    <details className={styles.more}>
      <summary>More detail</summary>
      <div className={styles.moreBody}>
        <p>{author ? <>Opinion of the Court by <strong>{author.name}</strong>. </> : lineup.majorityOpinionWriter ? <>Opinion of the Court by <strong>{lineup.majorityOpinionWriter}</strong>. </> : null}
          {majority.length} in the majority{concurring.length ? ` (${concurring.length} also concurring)` : ""}, {dissent.length} dissenting{other.length ? `, ${other.length} with no recorded vote` : ""}.</p>
        <ul className={styles.moreList} aria-label="Justice lineup">
          {lineup.votes.map((vote) => <li key={vote.scdbJusticeId}>
            {vote.slug ? <Link className={styles.link} href={`/justices/${vote.slug}` as Route}>{vote.name}</Link> : vote.name}: {lineupRole(vote)}{vote.scdbDirectionLabel ? ` · vote coded ${vote.scdbDirectionLabel}` : ""}
          </li>)}
        </ul>
        <p><strong>Reading this:</strong> the majority decides the case; a concurrence agrees with the result but adds or changes the reasoning; a dissent disagrees with the result. “Coded liberal/conservative” is the {SCDB_DIRECTION_LABEL}, applying its published rules to the side each justice voted for, not a statement about party. <a className={styles.link} href={SCDB_DIRECTION_DOC} rel="noopener">How SCDB codes direction →</a></p>
        <p><small>Evidence ledger</small>
          Source: <a className={styles.link} href={SCDB_HOME} rel="noopener">Supreme Court Database</a>{lineup.scdbVersion ? `, ${lineup.scdbVersion}` : ""}, case {lineup.scdbCaseId} ({termLabel(lineup.term)}).
          Linked by {MATCH_LABEL[lineup.matchMethod ?? ""] ?? "unknown"}{lineup.usCite ? ` (${lineup.usCite})` : ""}{lineup.docket ? `, docket ${lineup.docket}` : ""}; ambiguous matches are never linked.
          Decision: {lineup.decisionTypeLabel ?? "type not coded"}{lineup.issueAreaLabel ? ` · issue area: ${lineup.issueAreaLabel}` : ""} · SCDB direction: {lineup.scdbDecisionDirectionLabel ?? "not coded"}.
          Votes: {lineup.votes.length} justice rows: {majority.length} majority, {dissent.length} dissent, {other.length} not recorded.</p>
        {extra}
      </div>
    </details>
  </div>;
}

/**
 * "How the justices voted": one plain line, a chip per justice, the written opinions with their joiners merged
 * and the justice's own "why" first; quotes of the opening lines, the verbatim docket entry and the explainer sit
 * behind "More detail". Facts only; nothing here is a Jurvio summary.
 */
export function CaseJusticesVoted({ notes, lineup, extra }: { notes: CaseJusticeNotes | null; lineup: CaseLineup | null; extra?: ReactNode }) {
  const groups = notes ? groupVoteNotes(notes.notes) : [];
  if (!groups.length && !lineup && !extra) return null;
  return <div id="justice-notes" className={styles.root}>
    {lineup ? <LineupBlock lineup={lineup} extra={extra} /> : extra ? <details className={styles.more}><summary>More detail</summary><div className={styles.moreBody}>{extra}</div></details> : null}
    {notes ? groups.map((group, index) => <OrderBlock key={`${group.entryOn}|${group.context}`} group={group} bench={notes.bench}
      docketUrl={notes.sourceUrl} docketNumber={notes.docketNumber} primary={index === 0 && !lineup} />) : null}
  </div>;
}

/** Short heading hint for the collapsed section, e.g. "2 justices on record" or "6–3". */
export function justicesHint(notes: CaseJusticeNotes | null, lineup: CaseLineup | null): string | null {
  if (lineup?.voteSplit) return lineup.voteSplit.replace("-", "–");
  const first = notes ? groupVoteNotes(notes.notes)[0] : undefined;
  if (!first) return null;
  const count = [...publicNames(first)].length;
  return `${count} ${count === 1 ? "justice" : "justices"} on record`;
}
