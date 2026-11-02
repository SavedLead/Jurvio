import Link from "next/link";
import type { Route } from "next";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import type { KeyDate } from "@/modules/case-intelligence/domain/key-dates";
import type { SimilarCase } from "@/modules/citations/application/similar-cases";
import type { CircuitSplitSentence } from "@/modules/scotus/domain/circuit-split";

const muted = { color: "#5e687e", fontSize: ".9rem", lineHeight: 1.55 } as const;
const card = { padding: "12px 14px", border: "1px solid #dce1eb", borderRadius: 12, background: "#fff", lineHeight: 1.55 } as const;
const date = (value: string | null) => (value ? formatPublicCaseDate(value) ?? value : "Date not shown");

export function KeyDatesAheadSection({ dates, caseId, today }: { dates: KeyDate[]; caseId: string; today: string }) {
  if (!dates.length) return null;
  return <section className="contentSection caseFeatureSection" aria-labelledby="key-dates" id="key-dates-ahead">
    <div className="featureHeading"><div><p className="sectionKicker">Coming up</p><h2 id="key-dates">Key dates ahead</h2></div></div>
    <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
      {dates.map((item) => <li key={`${item.kind}:${item.date}:${item.entryPublicId ?? item.quote}`} style={card}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
          <strong>{date(item.date)}{item.time ? `, ${item.time}` : ""}</strong><span>{item.label}</span>
        </div>
        <p style={{ margin: "4px 0" }}>{item.plain}</p>
        <p style={{ ...muted, margin: 0 }}>Docket{item.entryNumber ? ` entry ${item.entryNumber}` : ""}{item.setOn ? `, ${date(item.setOn)}` : ""}: “{item.quote}” ·{" "}
          <Link href={(item.entryPublicId ? `/case/${caseId}/docket#entry-${item.entryPublicId}` : `/case/${caseId}/docket`) as Route}>Open the docket →</Link></p>
      </li>)}
    </ol>
    <p style={muted}>Only dates written on the public docket entries Jurvio holds, after {date(today)}. Courts often move dates; a change filed later may not be here yet, so check the court’s docket before relying on one.</p>
  </section>;
}

export function SimilarCasesSection({ cases }: { cases: SimilarCase[] }) {
  if (!cases.length) return null;
  return <section className="contentSection caseFeatureSection" aria-labelledby="similar-cases" id="cases-like-this">
    <div className="featureHeading"><div><p className="sectionKicker">Related reading</p><h2 id="similar-cases">Cases like this</h2></div></div>
    <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
      {cases.map((item) => <li key={item.publicId} style={card}>
        <Link href={`/case/${item.publicId}` as Route}><strong>{item.caption}</strong></Link>
        <p style={{ ...muted, margin: "2px 0" }}>{item.courtName}{item.decidedOn ? ` · decided ${date(item.decidedOn)}` : ""}</p>
        <p style={{ margin: "4px 0" }}>Both cite {item.shared} of the same earlier cases{item.sharedAuthorities.length ? <>, including {item.sharedAuthorities.map((authority, index) => <span key={authority.publicId}>{index ? (index === item.sharedAuthorities.length - 1 ? " and " : ", ") : ""}<Link href={`/case/${authority.publicId}` as Route}>{authority.caption}</Link></span>)}</> : null}.</p>
      </li>)}
    </ul>
    <p style={muted}>Picked by shared citations: cases whose opinions rely on the same, less-often-cited earlier decisions usually deal with similar legal questions. It is a reading list, not a finding that the cases are alike.</p>
  </section>;
}

export function CircuitSplitSection({ sentences, sourcePath, sourceLabel }: { sentences: CircuitSplitSentence[]; sourcePath: string; sourceLabel: string }) {
  if (!sentences.length) return null;
  const circuits = [...new Set(sentences.flatMap((item) => item.circuits))];
  return <section className="contentSection caseFeatureSection" aria-labelledby="circuit-split" id="circuit-split-section">
    <div className="featureHeading"><div><p className="sectionKicker">Why the Court took it</p><h2 id="circuit-split">A split among the circuits</h2></div></div>
    <p style={{ lineHeight: 1.6 }}>A <em>circuit split</em> is when federal appeals courts in different parts of the country decide the same legal question differently, so the law depends on where you live. Settling splits is one of the main reasons the Supreme Court agrees to hear a case.{circuits.length ? ` The text names the ${circuits.join(", ").replace(/, ([^,]*)$/, " and $1")} ${circuits.length === 1 ? "Circuit" : "Circuits"}.` : ""}</p>
    {sentences.map((item) => <blockquote key={item.sentence} style={{ margin: "10px 0", padding: "8px 12px", borderLeft: "3px solid #2f45c5", background: "#f6f7fb", lineHeight: 1.55 }}>“{item.sentence}”</blockquote>)}
    <p style={muted}>Quoted from <Link href={sourcePath as Route}>{sourceLabel}</Link>. Jurvio shows this only when the text itself says the courts disagree.</p>
  </section>;
}
