import type { ReactNode } from "react";
import type { CaseStanding } from "@/modules/plain-english/domain/case-standing";
import "./case-standing.css";

interface CaseStandingSectionProps {
  standing: CaseStanding;
  /** Renders plain text with dictionary-term tooltips (and citation links). */
  renderText: (text: string) => ReactNode;
  /**
   * Declutter layout: the headline and the "not legal advice" note live in the summary card, and an outside
   * source shows as its label plus a numbered reference into the page's one Sources list.
   */
  compact?: boolean;
  sourceRef?: (href: string) => ReactNode;
}

export function CaseStandingSection({ standing, renderText, compact = false, sourceRef }: CaseStandingSectionProps) {
  const source = (label: string, href: string | null | undefined) => {
    if (!href) return label;
    if (sourceRef && !href.startsWith("/") && !href.startsWith("#")) return <>{label}{sourceRef(href)}</>;
    return <a href={href} rel={href.startsWith("/") ? undefined : "nofollow noopener"}>{label}</a>;
  };
  return (
    <section className="caseStands" id="case-stands" aria-labelledby={compact ? undefined : "case-stands-title"} aria-label={compact ? "Where this case stands" : undefined}>
      {compact ? null : <p className="sectionKicker">Where this case stands</p>}
      {compact ? null : <h2 id="case-stands-title">{standing.headline}</h2>}
      <dl className="caseStandsList">
        {standing.points.map((point) => (
          <div className="caseStandsItem" key={point.id} data-point={point.id}>
            <dt>{point.label}</dt>
            <dd>
              {point.text ? <p>{renderText(point.text)}</p> : null}
              {point.items ? (
                <ul className="caseStandsAsks">
                  {point.items.map((item) => (
                    <li key={item.label} data-result={item.result}>
                      <span className="caseStandsAsk">{renderText(item.label)}{item.askedBy ? <span className="caseStandsAskBy"> — asked by {item.askedBy}</span> : null}</span>
                      <span className="caseStandsBadge">{item.badge}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {point.quote ? <blockquote>“{point.quote}”</blockquote> : null}
              {point.quotes?.map((quote, index) => (
                <figure className="caseStandsQuote" key={`${index}-${quote.text.slice(0, 24)}`}>
                  <blockquote>“{quote.text}”</blockquote>
                  <figcaption className="caseStandsSource">
                    {source(quote.sourceLabel, quote.sourceHref)}
                  </figcaption>
                </figure>
              ))}
              {point.sourceLabel ? (
                <p className="caseStandsSource">
                  {source(point.sourceLabel, point.sourceHref)}
                </p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {compact ? null : <p className="caseStandsNote">
        <strong>Plain-English summary, not legal advice.</strong> Generated from the court record by fixed rules; quotes are the court&apos;s own words. If the record doesn&apos;t say, we say so instead of guessing.
      </p>}
    </section>
  );
}
