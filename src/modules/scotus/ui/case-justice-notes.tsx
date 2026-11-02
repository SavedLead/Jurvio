import Link from "next/link";
import type { Route } from "next";
import type { CaseJusticeNote, CaseJusticeNotes } from "@/modules/scotus/application/justice-notes";
import type { JusticeNoteContext, JusticeNoteKind } from "@/modules/scotus/domain/docket-justice-notes";
import styles from "./justices.module.css";

/** The Court's own explainer: four "yes" votes grant a petition (the "Rule of Four"). */
export const RULE_OF_FOUR_SOURCE = "https://www.supremecourt.gov/visiting/activities/pdf/SupremeCourt101_January2026.pdf";

const GROUP_HEADING: Record<JusticeNoteContext, string> = {
  cert_denied: "The Court declined to hear the case",
  cert_granted: "The Court agreed to take the case",
  application: "The Court ruled on an application (a request made outside the normal schedule, often an emergency)",
  rehearing: "The Court ruled on a request to reconsider (a petition for rehearing)",
  other: "A Court order",
};

export function noteLabel(kind: JusticeNoteKind, context: JusticeNoteContext): string {
  const petition = context === "cert_denied" || context === "cert_granted";
  switch (kind) {
    case "would_grant": return context === "application" ? "Would have granted the request" : context === "rehearing" ? "Would have granted the rehearing" : "Would have taken the case";
    case "would_deny": return context === "application" ? "Would have denied the request" : petition ? "Would not have taken the case" : "Would have denied it";
    case "dissent": return context === "cert_denied" ? "Dissented from the decision not to hear it, in writing" : "Dissented (disagreed with the result), in writing";
    case "joined_dissent": return context === "cert_denied" ? "Dissented from the decision not to hear it, joining a colleague's written dissent" : "Dissented, joining a colleague's written dissent";
    case "statement": return "Wrote a statement about the order (explaining their view)";
    case "joined_statement": return "Joined a colleague's statement about the order";
    case "concurrence": return context === "cert_denied" ? "Agreed with not hearing it, and wrote separately to explain" : "Agreed with the result, and wrote separately";
    case "joined_concurrence": return "Agreed with the result, joining a colleague's separate writing";
    case "recused": return "Did not take part (sat this one out)";
  }
}

function writingWord(kind: JusticeNoteKind): string {
  return kind === "statement" ? "statement" : kind === "concurrence" ? "concurring opinion" : "dissent";
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function NoteItem({ note }: { note: CaseJusticeNote }) {
  const dissenting = note.kind === "dissent" || note.kind === "joined_dissent" || (note.kind === "would_grant" && note.context === "cert_denied") || (note.kind === "would_deny" && note.context === "cert_granted");
  const written = note.kind === "dissent" || note.kind === "statement" || note.kind === "concurrence";
  return <li className={dissenting ? styles.lineupDissent : styles.lineupMajority} data-note-kind={note.kind}>
    <strong>{note.slug ? <Link className={styles.link} href={`/justices/${note.slug}` as Route}>{note.name}</Link> : note.name}</strong>
    <span>{noteLabel(note.kind, note.context)}</span>
    {written && note.opinionOpening ? <blockquote className={styles.noteQuote}>
      <small>How the {writingWord(note.kind)} begins:</small> “{note.opinionOpening}”
    </blockquote> : null}
    {written && note.opinionReason ? <blockquote className={styles.noteQuote}>
      <small>In the justice’s words, why:</small> “{note.opinionReason}”
    </blockquote> : null}
    {note.opinionUrl && (written || note.kind.startsWith("joined_")) ? <a className={styles.link} href={note.opinionUrl} rel="noopener">
      {written ? `Read the full ${writingWord(note.kind)} (official PDF) →` : "Read the opinion they joined (official PDF) →"}
    </a> : null}
  </li>;
}

/** Justice-by-justice positions the Supreme Court made public on this case's docket. Facts only, quoted. */
export function CaseJusticeNotesSection({ data }: { data: CaseJusticeNotes }) {
  const groups = new Map<string, CaseJusticeNote[]>();
  for (const note of data.notes) {
    const key = `${note.entryOn}|${note.context}`;
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const hasDenial = data.notes.some((note) => note.context === "cert_denied");
  const publicNames = [...new Set(data.notes.filter((note) => note.context === "cert_denied" && note.kind !== "recused").map((note) => note.name))];
  const hasQuotes = data.notes.some((note) => note.opinionOpening || note.opinionReason);
  return <section className="contentSection caseFeatureSection" aria-labelledby="justice-notes" id="justice-notes">
    <div className="featureHeading decisionHeading">
      <h2 id="justice-notes">{hasDenial ? "Justices who spoke up about turning this case away" : "What individual justices put on the record"}</h2>
      {hasDenial && publicNames.length ? <strong className="decisionLabel">{publicNames.length} {publicNames.length === 1 ? "justice" : "justices"} on record</strong> : null}
    </div>
    <p style={{ color: "#4b556b", lineHeight: 1.6 }}>
      {hasDenial
        ? <>The Supreme Court decided not to hear this case (it <em>denied certiorari</em>, the request to review a lower court’s decision). When it turns a case away, the Court usually does not say how each justice voted. The docket names only the justices who chose to make their position public, and that is all we show here. <strong>The other justices’ votes are not made public.</strong></>
        : <>These are the positions individual justices chose to put on the Court’s docket when it acted. The Court does not publish the other justices’ votes on these orders.</>}
    </p>
    {[...groups.entries()].map(([key, notes]) => {
      const [entryOn = "", context = "other"] = key.split("|") as [string, JusticeNoteContext];
      const entryText = (notes[0]?.entryText ?? "").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
      return <div key={key} className={styles.noteGroup}>
        <h3 style={{ marginBottom: 0 }}>{GROUP_HEADING[context]} · <time dateTime={entryOn}>{formatDate(entryOn)}</time></h3>
        <ul className={styles.noteList}>{notes.map((note) => <NoteItem key={`${note.justiceRef}:${note.kind}`} note={note} />)}</ul>
        <blockquote className={styles.noteDocket}>
          <small>The Court’s docket entry, word for word:</small> “{entryText}”{" "}
          <a className={styles.link} href={data.sourceUrl} rel="noopener">Official docket, No. {data.docketNumber} →</a>
        </blockquote>
      </div>;
    })}
    <aside className={styles.explain}>
      <p><strong>Reading this:</strong> a <em>dissent</em> means the justice disagreed with what the Court did; a <em>statement</em> explains a justice’s view without necessarily disagreeing; “would grant” means the justice would have taken the case. Taking a case needs four of the nine justices to vote yes (the “Rule of Four”; <a className={styles.link} href={RULE_OF_FOUR_SOURCE} rel="noopener">Supreme Court explainer, PDF</a>), so when a case is turned away we know fewer than four voted to hear it, but not who.</p>
      {hasQuotes ? <p>Quotes are the opening lines of the justice’s own writing and, where one is found by a fixed rule, the sentence where they say why. They are not a summary written by Jurvio.</p> : null}
    </aside>
  </section>;
}
