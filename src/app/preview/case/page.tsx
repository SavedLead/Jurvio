import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { presentCaseStatus, readableStatusValue } from "@/modules/cases/domain/plain-language";
import { CaseFaq } from "@/modules/cases/ui/case-faq";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { LegalTermHint } from "@/modules/cases/ui/legal-term";

export const metadata: Metadata = {
  title: "Synthetic case preview",
  robots: { index: false, follow: false },
};

const demoCase = {
  publicId: "jv-a7k9m2q4x",
  caption: "Acme Health Systems, Inc. v. Northstar Analytics LLC",
  docketNumber: "1:25-cv-01472",
  filedOn: "2025-03-18",
  terminatedOn: null,
  natureOfSuitCode: "190 Contract: Other",
  causeOfAction: "28 U.S.C. § 1332 Diversity jurisdiction",
  courtName: "United States District Court for the Southern District of New York",
  activityState: "active",
  proceduralPhase: "discovery",
  dispositionScope: "partial",
  judgmentState: "none",
  appealState: "unavailable",
  verification: "verified",
  statusExplanation:
    "The case remains active. The court denied part of the motion to dismiss, allowed the remaining claims to proceed, and directed the parties to continue discovery.",
  statusRuleVersion: "preview-1",
} as const;

const demoTimeline = [
  ["2026-07-08", "The court approved the parties’ revised discovery schedule."],
  ["2026-06-12", "Northstar Analytics answered the remaining claims."],
  ["2026-05-29", "The court granted the motion to dismiss in part and denied it in part."],
  ["2025-03-18", "Acme Health Systems filed the complaint."],
] as const;

export default function SyntheticCasePreview() {
  if (process.env.JURVIO_PREVIEW_MODE !== "true") notFound();
  const status = presentCaseStatus(demoCase);

  return (
    <main className="shell caseShell">
      <div className="previewBanner" role="status">
        Preview only · All names and records on this page are synthetic
      </div>
      <CaseHeader
        caseId={demoCase.publicId}
        caption={demoCase.caption}
        courtName={demoCase.courtName}
        docketNumber={demoCase.docketNumber}
        filedOn={demoCase.filedOn}
      />

      <div className="caseLayout">
        <article className="caseMain">
          <section className="statusCard isVerified" aria-labelledby="current-status">
            <div className="statusHeading">
              <div>
                <p className="sectionKicker">Current status</p>
                <h2 id="current-status">{status.headline}</h2>
              </div>
              <span className="verificationBadge">Source-verified</span>
            </div>
            <p className="statusExplanation">{status.explanation}</p>
            <dl className="statusGrid">
              <div><dt>Activity</dt><dd>{readableStatusValue(demoCase.activityState)}</dd></div>
              <div><dt>Phase</dt><dd>{readableStatusValue(demoCase.proceduralPhase)}</dd></div>
              <div><dt><LegalTermHint term="disposition" /></dt><dd>{readableStatusValue(demoCase.dispositionScope)}</dd></div>
              <div><dt>Judgment</dt><dd>{readableStatusValue(demoCase.judgmentState)}</dd></div>
              <div><dt><LegalTermHint term="appeal" /></dt><dd>{readableStatusValue(demoCase.appealState)}</dd></div>
            </dl>
            <p className="sourceNote">
              Status explanations come from deterministic rules applied to qualifying court events.
              Jurvio does not predict outcomes.
            </p>
          </section>

          <section className="contentSection" aria-labelledby="case-overview">
            <p className="sectionKicker">At a glance</p>
            <h2 id="case-overview">Case overview</h2>
            <dl className="factList">
              <div><dt>Court</dt><dd>{demoCase.courtName}</dd></div>
              <div><dt>Docket number</dt><dd>{demoCase.docketNumber}</dd></div>
              <div><dt>Filed</dt><dd>{demoCase.filedOn}</dd></div>
              <div><dt>Terminated</dt><dd>No verified termination date</dd></div>
              <div><dt>Nature of suit</dt><dd>{demoCase.natureOfSuitCode}</dd></div>
              <div><dt>Cause of action</dt><dd>{demoCase.causeOfAction}</dd></div>
            </dl>
          </section>

          <section className="contentSection" aria-labelledby="case-timeline-preview">
            <p className="sectionKicker">Latest developments</p>
            <h2 id="case-timeline-preview">Case timeline</h2>
            <ol className="recordList">
              {demoTimeline.map(([date, description]) => (
                <li key={date + description}>
                  <time>{date}</time>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="contentSection" aria-labelledby="legal-language">
            <p className="sectionKicker">Understand the language</p>
            <h2 id="legal-language">Legal terms in plain English</h2>
            <p>
              This case involves <LegalTermHint term="jurisdiction" />, a motion related to
              dismissal, and the possibility of <LegalTermHint term="summary judgment" /> later.
              Hover over or focus a lightly underlined term to see what it means.
            </p>
          </section>

          <CaseFaq
            caption={demoCase.caption}
            courtName={demoCase.courtName}
            docketNumber={demoCase.docketNumber}
            filedOn={demoCase.filedOn}
            status={status.explanation}
          />
        </article>

        <aside className="caseAside" aria-label="About this record">
          <div className="asideCard">
            <h2>About this record</h2>
            <p>
              Jurvio reorganizes public court information so it is easier to understand.
              Jurvio is not the court and does not provide legal advice.
            </p>
            <p>
              Allegations are claims, not findings. A person or organization named in a case
              is not necessarily liable or guilty.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
