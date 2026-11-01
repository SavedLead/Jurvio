import type { ReactNode } from "react";
import type { CaseStanding } from "@/modules/plain-english/domain/case-standing";
import "./case-standing.css";

interface CaseStandingSectionProps {
  standing: CaseStanding;
  /** Renders plain text with dictionary-term tooltips (and citation links). */
  renderText: (text: string) => ReactNode;
}

export function CaseStandingSection({ standing, renderText }: CaseStandingSectionProps) {
  return (
    <section className="caseStands" id="case-stands" aria-labelledby="case-stands-title">
      <p className="sectionKicker">Where this case stands</p>
      <h2 id="case-stands-title">{standing.headline}</h2>
      <dl className="caseStandsList">
        {standing.points.map((point) => (
          <div className="caseStandsItem" key={point.id} data-point={point.id}>
            <dt>{point.label}</dt>
            <dd>
              <p>{renderText(point.text)}</p>
              {point.quote ? <blockquote>“{point.quote}”</blockquote> : null}
              {point.sourceLabel ? (
                <p className="caseStandsSource">
                  {point.sourceHref
                    ? <a href={point.sourceHref} rel={point.sourceHref.startsWith("/") ? undefined : "nofollow noopener"}>{point.sourceLabel}</a>
                    : point.sourceLabel}
                </p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="caseStandsNote">
        <strong>Plain-English summary, not legal advice.</strong> Generated from the court record by fixed rules; quotes are the court&apos;s own words. If the record doesn&apos;t say, we say so instead of guessing.
      </p>
    </section>
  );
}
