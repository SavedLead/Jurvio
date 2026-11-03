import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import { buildCaseJourney, daysBetween, gapLabel, isEmergencyApplication, plainSpan, type JourneyBenchmarks, type JourneyInput, type Median } from "@/modules/scotus/domain/case-journey";
import type { OnwardScotusCase } from "@/modules/scotus/application/case-journey";

const muted = { color: "#5e687e", fontSize: ".9rem", lineHeight: 1.55 } as const;
const date = (value: string) => formatPublicCaseDate(value) ?? value;

function MedianLine({ label, median }: { label: string; median: Median }) {
  return <li><strong>{plainSpan(median.cases >= 20 ? median.days : null)}</strong> {label}{" "}
    <span style={muted}>({median.cases.toLocaleString()} {median.cases === 1 ? "docket" : "dockets"} with both dates{median.cases < 20 ? "; too few to show a typical time" : ""})</span></li>;
}

/** The case's path from the court below to the Supreme Court's last action, from the official docket. */
export function CaseJourneySection({ journey, benchmarks, sourceRef }: {
  journey: JourneyInput; benchmarks: JourneyBenchmarks | null;
  /** Declutter layout: show "Source: label [n]" pointing into the page's one Sources list instead of a link per step. */
  sourceRef?: (href: string) => ReactNode;
}) {
  const steps = buildCaseJourney(journey);
  if (!steps.length) return null;
  const application = isEmergencyApplication(journey.docketNumber);
  const first = steps[0]!.date;
  const last = steps[steps.length - 1]!.date;
  const total = steps.length > 1 ? daysBetween(first, last) : null;
  return <section className="contentSection caseFeatureSection" aria-labelledby="case-journey" id="journey">
    <div className="featureHeading">
      <div><p className="sectionKicker">{application ? "Emergency application" : "Case journey"}</p><h2 id="case-journey">How this case reached the Supreme Court</h2></div>
      {total !== null ? <strong className="decisionLabel">{plainSpan(total)} from first to last step shown</strong> : null}
    </div>
    <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 0 }}>
      {steps.map((step, index) => {
        const gap = index > 0 ? gapLabel(daysBetween(steps[index - 1]!.date, step.date)) : null;
        return <li key={step.key} style={{ position: "relative", padding: "0 0 18px 26px", borderLeft: index < steps.length - 1 ? "2px solid #d6dcea" : "2px solid transparent", marginLeft: 6 }}>
          <span aria-hidden style={{ position: "absolute", left: -7, top: 3, width: 12, height: 12, borderRadius: 999, background: step.key === "judgment" || step.key === "cert" ? "#2f45c5" : "#fff", border: "2px solid #2f45c5" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
            <time dateTime={step.date} style={{ fontWeight: 600 }}>{date(step.date)}</time>
            {gap ? <span style={muted}>{gap}</span> : null}
          </div>
          <strong style={{ display: "block", marginTop: 2 }}>{step.title}</strong>
          <p style={{ margin: "4px 0", lineHeight: 1.55 }}>{step.plain}</p>
          {step.quote ? <p style={{ ...muted, margin: "4px 0" }}>Docket: “{step.quote}”</p> : null}
          <p style={{ ...muted, margin: 0 }}>
            {step.sourceUrl && sourceRef ? <>Source: {step.sourceLabel}{sourceRef(step.sourceUrl)}</>
              : step.sourceUrl ? <a href={step.sourceUrl} rel="noopener noreferrer" target="_blank">Source: {step.sourceLabel} ↗</a> : `Source: ${step.sourceLabel}`}
            {step.jurvioPath ? <> · <Link href={step.jurvioPath as Route}>Open the lower-court case on Jurvio →</Link></> : null}
          </p>
        </li>;
      })}
    </ol>
    {journey.lowerCourt && !journey.linkedLowerCase ? <p style={muted}>Jurvio could not link the lower-court case itself{journey.lowerCaseNumbers.length ? ` (No. ${journey.lowerCaseNumbers.join(", ")})` : ""}: either we do not hold it, or the number matches more than one case. The court below and its decision date come from the Supreme Court docket.</p> : null}
    <p style={muted}>The first trial-court (district court) filing is not shown: the Supreme Court docket names only the court that ruled just before it, and Jurvio’s records do not connect appeals cases to the district cases they came from, so we cannot say how long the whole case has taken.</p>
    {benchmarks ? <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", color: "#2f45c5" }}>Typical times at the Supreme Court</summary>
      {application ? <ul style={{ lineHeight: 1.7 }}>
        <MedianLine label="from an emergency application's filing to its latest docket entry" median={benchmarks.applications.filingToLatestEntry} />
      </ul> : <ul style={{ lineHeight: 1.7 }}>
        <MedianLine label="from the lower court's decision to the petition being docketed" median={benchmarks.petitions.lowerToFiling} />
        <MedianLine label="from docketing to a denial, for petitions the Court turned down" median={benchmarks.petitions.filingToCertDenied} />
        <MedianLine label="from docketing to the Court's judgment, for cases it decided" median={benchmarks.petitions.filingToJudgment} />
      </ul>}
      <p style={muted}>Medians (the middle case) across the {benchmarks.docketsHeld.toLocaleString()} Supreme Court dockets Jurvio holds{benchmarks.earliestDocketed ? `, docketed since ${date(benchmarks.earliestDocketed)}` : ""}. Emergency “A” applications ({benchmarks.applications.held.toLocaleString()} held) are counted separately from petitions because they move on a different, much faster track. Jurvio holds only some dockets, so these are not official Court statistics.</p>
    </details> : null}
  </section>;
}

/** On an appeals case: the Supreme Court docket that names this case as the decision below. */
export function OnwardSupremeCourtSection({ cases }: { cases: OnwardScotusCase[] }) {
  if (!cases.length) return null;
  return <section className="contentSection caseFeatureSection" aria-labelledby="onward-scotus" id="journey">
    <div className="featureHeading"><div><p className="sectionKicker">Case journey</p><h2 id="onward-scotus">This case went on to the Supreme Court</h2></div></div>
    <ul style={{ lineHeight: 1.7 }}>
      {cases.map((item) => <li key={item.publicId}>
        <Link href={`/case/${item.publicId}#journey` as Route}>{item.caption}</Link> (No. {item.docketNumber}){" "}
        <span style={muted}>{item.judgmentOn ? `decided ${date(item.judgmentOn)}` : item.certStatus === "denied" && item.certStatusOn ? `review denied ${date(item.certStatusOn)}` : item.certStatus === "granted" && item.certStatusOn ? `review granted ${date(item.certStatusOn)}` : "status on the Supreme Court docket"}</span>
      </li>)}
    </ul>
    <p style={muted}>Linked because the official Supreme Court docket lists this case’s number and circuit as the decision below.</p>
  </section>;
}
