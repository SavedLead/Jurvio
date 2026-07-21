import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { presentCaseStatus, readableStatusValue } from "@/modules/cases/domain/plain-language";
import { CaseFaq } from "@/modules/cases/ui/case-faq";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { LegalTermHint } from "@/modules/cases/ui/legal-term";

export const dynamic = "force-dynamic";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

export async function generateMetadata({ params }: CasePageProps): Promise<Metadata> {
  const { caseId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId)) return {};
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) return {};

  return {
    title: legalCase.caption,
    description:
      "Read the current status, docket, parties, documents, and plain-English procedural context for " +
      legalCase.caption +
      ".",
    alternates: { canonical: "/case/" + caseId },
    openGraph: {
      title: legalCase.caption,
      description: "Public, source-backed case information from " + legalCase.courtName + ".",
      type: "article",
    },
  };
}

export default async function CasePage({ params }: CasePageProps) {
  const { caseId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId)) notFound();

  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const status = presentCaseStatus(legalCase);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: legalCase.caption,
    description: status.explanation,
    identifier: legalCase.publicId,
    datePublished: legalCase.filedOn,
    about: {
      "@type": "Thing",
      name: legalCase.caption,
      identifier: legalCase.docketNumber,
    },
    isPartOf: { "@type": "WebSite", name: "Jurvio" },
  };

  return (
    <main className="shell caseShell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c"),
        }}
      />
      <CaseHeader
        caseId={caseId}
        caption={legalCase.caption}
        courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber}
        filedOn={legalCase.filedOn}
      />

      <div className="caseLayout">
        <article className="caseMain">
          <section className={"statusCard " + (status.verified ? "isVerified" : "needsVerification")} aria-labelledby="current-status">
            <div className="statusHeading">
              <div>
                <p className="sectionKicker">Current status</p>
                <h2 id="current-status">{status.headline}</h2>
              </div>
              <span className="verificationBadge">
                {status.verified ? "Source-verified" : "Verification pending"}
              </span>
            </div>
            <p className="statusExplanation">{status.explanation}</p>
            <dl className="statusGrid">
              <div><dt>Activity</dt><dd>{readableStatusValue(legalCase.activityState)}</dd></div>
              <div><dt>Phase</dt><dd>{readableStatusValue(legalCase.proceduralPhase)}</dd></div>
              <div><dt><LegalTermHint term="disposition" /></dt><dd>{readableStatusValue(legalCase.dispositionScope)}</dd></div>
              <div><dt>Judgment</dt><dd>{readableStatusValue(legalCase.judgmentState)}</dd></div>
              <div><dt><LegalTermHint term="appeal" /></dt><dd>{readableStatusValue(legalCase.appealState)}</dd></div>
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
              <div><dt>Court</dt><dd>{legalCase.courtName}</dd></div>
              <div><dt>Docket number</dt><dd>{legalCase.docketNumber}</dd></div>
              <div><dt>Filed</dt><dd>{legalCase.filedOn ?? "Date unavailable"}</dd></div>
              <div><dt>Terminated</dt><dd>{legalCase.terminatedOn ?? "No verified termination date"}</dd></div>
              <div><dt>Nature of suit</dt><dd>{legalCase.natureOfSuitCode ?? "Not available"}</dd></div>
              <div><dt>Cause of action</dt><dd>{legalCase.causeOfAction ?? "Not available"}</dd></div>
            </dl>
          </section>

          <section className="contentSection" aria-labelledby="legal-language">
            <p className="sectionKicker">Understand the language</p>
            <h2 id="legal-language">Legal terms in plain English</h2>
            <p>
              Court records may use terms such as <LegalTermHint term="jurisdiction" />,{" "}
              <LegalTermHint term="summary judgment" />,{" "}
              <LegalTermHint term="dismissed with prejudice" />, and{" "}
              <LegalTermHint term="dismissed without prejudice" />. Hover over or focus a
              lightly underlined term to see what it means.
            </p>
          </section>

          <CaseFaq
            caption={legalCase.caption}
            courtName={legalCase.courtName}
            docketNumber={legalCase.docketNumber}
            filedOn={legalCase.filedOn}
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
