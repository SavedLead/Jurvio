import type { Metadata } from "next";
import { briefExcerpt, isBlankish } from "@/modules/cases/domain/reporter-text";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { loadCaseForViewer } from "@/app/case/load-public-case";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import { PublicCaseTools } from "@/modules/cases/ui/public-case-tools";
import { readKeyDatesAhead } from "@/modules/case-intelligence/domain/key-dates";
import "./summary.css";

export const dynamic = "force-dynamic";

const date = (value: string | null | undefined) => (value ? formatPublicCaseDate(value) ?? value : null);
const muted = { color: "#5e687e", fontSize: ".9rem", lineHeight: 1.55 } as const;

function todayInNewYork() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function generateMetadata({ params }: { params: Promise<{ caseId: string }> }): Promise<Metadata> {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") return { title: "Case not found" };
  if (access.status === "gated") return subscriberGateMetadata();
  const caption = cleanCaseCaption(access.legalCase.caption);
  return {
    title: { absolute: `${caption}: one-page summary | Jurvio` },
    description: `A one-page summary of ${caption} (${access.legalCase.courtName}, No. ${access.legalCase.docketNumber}) from the court record, with sources.`,
    alternates: { canonical: `/case/${caseId}` },
    robots: { index: false, follow: true },
  };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 2 }}><dt style={{ ...muted, fontSize: ".8rem", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{children}</dd></div>;
}

function Sourced({ title, text, sourceUrl, moreHref }: { title: string; text: string | null | undefined; sourceUrl: string | null | undefined; moreHref: string }) {
  if (!text || isBlankish(text)) return null;
  const brief = briefExcerpt(text, 700);
  return <section style={{ margin: "18px 0" }}>
    <h2 style={{ fontSize: "1.05rem", margin: "0 0 6px" }}>{title}</h2>
    <p style={{ margin: 0, lineHeight: 1.6 }}>{brief.text}</p>
    <p style={{ ...muted, margin: "4px 0 0" }}>
      {brief.truncated ? <><a href={moreHref}>Shortened here; full text on the case page →</a>{sourceUrl ? " · " : null}</> : null}
      {sourceUrl ? <a href={sourceUrl} rel="noopener noreferrer" target="_blank">Source ↗</a> : null}
    </p>
  </section>;
}

export default async function CaseSummaryPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") notFound();
  if (access.status === "gated") return <SubscriberCaseGate path={`/case/${caseId}/summary`} />;
  const legalCase = access.legalCase;
  const caption = cleanCaseCaption(legalCase.caption);
  const entries = await listPublicDocketEntries(db(), caseId, 250).catch(() => []);
  const today = todayInNewYork();
  const keyDates = readKeyDatesAhead(entries.map((entry) => ({ publicId: entry.publicId, entryNumber: entry.entryNumber, filedOn: entry.filedOn, description: entry.description })), today, 4, legalCase.terminatedOn ?? legalCase.decidedOn ?? null);
  const latest = entries.filter((entry) => entry.filedOn).slice(0, 5);
  const verified = legalCase.verification === "verified";
  const permanentUrl = `https://jurvio.com/case/${caseId}/summary`;
  const closedOn = legalCase.decidedOn ?? legalCase.terminatedOn ?? null;
  return <main className="shell caseShell" style={{ maxWidth: 820 }}>
    <p className="sectionKicker">One-page summary</p>
    <h1 style={{ margin: "4px 0 12px", lineHeight: 1.2 }}>{caption}</h1>
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px 18px", margin: "0 0 12px" }}>
      <Fact label="Court">{legalCase.courtName}</Fact>
      <Fact label="Case number">{legalCase.docketNumber}</Fact>
      {legalCase.officialCitation ? <Fact label="Citation">{legalCase.officialCitation}</Fact> : null}
      <Fact label="Filed">{date(legalCase.filedOn) ?? "Not shown in the records"}</Fact>
      <Fact label={legalCase.decidedOn ? "Decided" : "Closed"}>{date(closedOn) ?? "No closing date in the records"}</Fact>
    </dl>
    <div className="caseSummaryTools"><PublicCaseTools permanentUrl={permanentUrl} shareTitle={`${caption}: one-page summary`} citation={legalCase.officialCitation} /></div>
    {verified ? <>
      <Sourced title="What happened" text={legalCase.backgroundSummary ?? legalCase.statusExplanation} sourceUrl={legalCase.backgroundSourceUrl} moreHref={`/case/${caseId}`} />
      <Sourced title="The question" text={legalCase.questionPresented} sourceUrl={legalCase.questionSourceUrl} moreHref={`/case/${caseId}`} />
      <Sourced title="The ruling" text={legalCase.exactHolding} sourceUrl={legalCase.holdingSourceUrl ?? legalCase.dispositionSourceUrl} moreHref={`/case/${caseId}`} />
      <Sourced title="Why it matters" text={legalCase.significanceSummary} sourceUrl={legalCase.significanceSourceUrl} moreHref={`/case/${caseId}`} />
    </> : <p style={{ ...muted, margin: "18px 0" }}>Jurvio has not verified a written summary of this case, so this page lists only facts from the court record.</p>}
    {keyDates.length ? <section style={{ margin: "18px 0" }}>
      <h2 style={{ fontSize: "1.05rem", margin: "0 0 6px" }}>Key dates ahead</h2>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        {keyDates.map((item) => <li key={`${item.kind}:${item.date}:${item.quote}`}><strong>{date(item.date)}{item.time ? `, ${item.time}` : ""}</strong>: {item.label}. <span style={muted}>Docket: “{item.quote}”</span></li>)}
      </ul>
      <p style={muted}>As written on the docket; courts often move dates.</p>
    </section> : null}
    {latest.length ? <section style={{ margin: "18px 0" }}>
      <h2 style={{ fontSize: "1.05rem", margin: "0 0 6px" }}>Latest on the docket</h2>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        {latest.map((entry) => <li key={entry.publicId}><strong>{date(entry.filedOn)}</strong>: {entry.description.length > 220 ? `${entry.description.slice(0, 219).trimEnd()}…` : entry.description}</li>)}
      </ul>
      <p style={muted}><Link href={`/case/${caseId}/docket` as Route}>Full public docket →</Link></p>
    </section> : null}
    <footer style={{ ...muted, borderTop: "1px solid #dce1eb", marginTop: 24, paddingTop: 10 }}>
      From the court records Jurvio holds, as of {date(today)}. Not legal advice. Full case page with every source: <Link href={`/case/${caseId}` as Route}>jurvio.com/case/{caseId}</Link>
    </footer>
  </main>;
}
