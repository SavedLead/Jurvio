import type { ReactNode } from "react";
import type { PlainTerm } from "@/modules/plain-english/domain/term-index";
import "./case-declutter.css";

export interface CaseSourceLink { n: number; label: string; href: string }

/** Numbered list of every external source and official link on the page (deduplicated by URL). */
export class CaseSourceList {
  private readonly byHref = new Map<string, CaseSourceLink>();
  add(label: string | null | undefined, href: string | null | undefined): number | null {
    if (!href || href.startsWith("/") || href.startsWith("#")) return null;
    const existing = this.byHref.get(href);
    if (existing) {
      // A generic first label ("Source") gives way to the first descriptive one.
      if (label?.trim() && /^(source|official source)$/i.test(existing.label)) existing.label = label.trim();
      return existing.n;
    }
    const link = { n: this.byHref.size + 1, label: label?.trim() || href, href };
    this.byHref.set(href, link);
    return link.n;
  }
  number(href: string | null | undefined): number | null { return href ? this.byHref.get(href)?.n ?? null : null; }
  get links(): CaseSourceLink[] { return [...this.byHref.values()]; }
}

/** "[2]" pointing at the Sources area. */
export function SourceRef({ n }: { n: number | null }) {
  if (!n) return null;
  return <a className="cdRef" href={`#source-${n}`} aria-label={`Source ${n}`}>[{n}]</a>;
}

interface SummaryCardProps {
  whatHappened: ReactNode;
  whoWon?: ReactNode;
  whoWonLabel?: string;
  goingForward?: ReactNode;
  goingForwardLabel?: string;
  keyDate?: { label: string; date: string; display: string } | null;
  facts: Array<[string, ReactNode]>;
  follow?: ReactNode;
  tools?: ReactNode;
  note?: ReactNode;
}

/** The short card at the top: what happened, who won, what it means, the key date, and Follow. */
export function CaseSummaryCard({ whatHappened, whoWon, whoWonLabel = "Who won", goingForward, goingForwardLabel = "Going forward", keyDate, facts, follow, tools, note }: SummaryCardProps) {
  return <section className="cdSummary" aria-labelledby="case-summary-title" id="case-summary">
    <h2 id="case-summary-title" className="cdSummaryHeadline">{whatHappened}</h2>
    {whoWon || goingForward || keyDate ? <dl className="cdSummaryList">
      {whoWon ? <div><dt>{whoWonLabel}</dt><dd>{whoWon}</dd></div> : null}
      {goingForward ? <div><dt>{goingForwardLabel}</dt><dd>{goingForward}</dd></div> : null}
      {keyDate ? <div><dt>{keyDate.label}</dt><dd><time dateTime={keyDate.date}>{keyDate.display}</time></dd></div> : null}
    </dl> : null}
    {facts.length ? <dl className="cdFacts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
    <div className="cdActions">
      {follow}
      {tools}
    </div>
    {note ? <p className="cdNote">{note}</p> : null}
  </section>;
}

/** One collapsible detail section with a clear title and a one-line hint of what is inside. */
export function CaseSection({ id, title, hint, open = false, hideHeading = false, children }: {
  id: string; title: string; hint?: ReactNode; open?: boolean;
  /** The one component inside repeats the section title: hide its own kicker and heading. */
  hideHeading?: boolean; children: ReactNode;
}) {
  return <details className="cdSection" id={`${id}-section`} open={open} data-section={id} data-hide-heading={hideHeading ? "" : undefined}>
    <summary><h2 className="cdSectionTitle">{title}</h2>{hint ? <span className="cdHint">{hint}</span> : null}</summary>
    <div className="cdBody">{children}</div>
  </details>;
}

export function CaseSources({ links }: { links: CaseSourceLink[] }) {
  if (!links.length) return null;
  return <ol className="cdSources">
    {links.map((link) => <li key={link.href} id={`source-${link.n}`}><a href={link.href} rel="nofollow noopener">{link.label}</a></li>)}
  </ol>;
}

/** One glossary for the plain-English terms used on the page (the inline tooltips stay too). */
export function CaseGlossary({ terms }: { terms: PlainTerm[] }) {
  if (!terms.length) return null;
  return <dl className="cdGlossary">
    {terms.map((term) => <div key={term.key} id={`glossary-${term.key}`}>
      <dt>{term.term}</dt>
      <dd>{term.definition} <a href={term.href}>Learn more<span className="ptSrOnly"> about {term.term.toLowerCase()}</span></a></dd>
    </div>)}
  </dl>;
}
