/**
 * A Supreme Court case's journey through the courts, read only from official records Jurvio holds:
 * the Supreme Court docket (lower court, its decision date, filing, the Court's action, argument, judgment)
 * and, where the docket names the lower-court case number, the matching appeals case in Jurvio.
 * Nothing is inferred: a step the records do not show is left out and said so.
 */

export type JourneyStepKey = "lower-decided" | "docketed" | "cert" | "argued" | "judgment" | "application-ruling";

export interface JourneyStep {
  key: JourneyStepKey;
  date: string;
  title: string;
  plain: string;
  /** The record's own words, when it has a line for the step. */
  quote: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
  /** Jurvio page for this step (the lower-court case), when one is linked. */
  jurvioPath: string | null;
}

export interface JourneyInput {
  docketNumber: string;
  officialDocketUrl: string | null;
  lowerCourt: string | null;
  lowerCourtDecidedOn: string | null;
  lowerCaseNumbers: string[];
  linkedLowerCase: { publicId: string; caption: string; docketNumber: string | null } | null;
  docketedOn: string | null;
  certStatus: "granted" | "denied" | "dismissed" | "pending" | null;
  certStatusOn: string | null;
  certEntry: string | null;
  judgmentOn: string | null;
  judgmentEntry: string | null;
  entries: { filedOn: string | null; description: string }[];
}

/** An emergency application ("24A123"): a request to a Justice for quick action, not a petition for review. */
export function isEmergencyApplication(docketNumber: string | null | undefined): boolean {
  return /^\d{2}A\d{1,4}$/i.test((docketNumber ?? "").trim());
}

export function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function clip(text: string | null | undefined, max = 220) {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value ? (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value) : null;
}

const ARGUED = /^Argued\b/i;
const APPLICATION_RULING = /\bApplication\b[^.]{0,120}?\b(granted|denied|referred to the Court)\b/i;

export function buildCaseJourney(input: JourneyInput): JourneyStep[] {
  const steps: JourneyStep[] = [];
  const docket = { sourceUrl: input.officialDocketUrl, sourceLabel: "Supreme Court docket" };
  const application = isEmergencyApplication(input.docketNumber);
  if (input.lowerCourt && input.lowerCourtDecidedOn) {
    const numbers = input.lowerCaseNumbers.length ? ` (No. ${input.lowerCaseNumbers.join(", ")})` : "";
    steps.push({
      key: "lower-decided", date: input.lowerCourtDecidedOn, title: `${input.lowerCourt} decided the case`,
      plain: `The court below ruled${numbers}. The losing side then asked the Supreme Court to step in.`,
      quote: null, ...docket,
      jurvioPath: input.linkedLowerCase ? `/case/${input.linkedLowerCase.publicId}` : null,
    });
  }
  if (input.docketedOn) {
    steps.push({
      key: "docketed", date: input.docketedOn,
      title: application ? "Emergency application filed" : "Petition filed at the Supreme Court",
      plain: application
        ? "An emergency application asks a Justice (or the full Court) for quick, temporary action, such as pausing a lower-court order, while the case goes on."
        : "A petition for certiorari asks the Supreme Court to review the lower court's decision. The Court agrees to hear only a small share.",
      quote: null, ...docket, jurvioPath: null,
    });
  }
  if (!application && input.certStatusOn && input.certStatus && input.certStatus !== "pending") {
    const title = input.certStatus === "granted" ? "The Court agreed to hear it" : input.certStatus === "denied" ? "The Court declined to hear it" : "The case was dismissed";
    const plain = input.certStatus === "granted" ? "Certiorari granted: the Court took the case for full review."
      : input.certStatus === "denied" ? "Certiorari denied: the lower court's decision stands. A denial is not a ruling on who was right."
      : "The case left the Court without a decision on the merits.";
    steps.push({ key: "cert", date: input.certStatusOn, title, plain, quote: clip(input.certEntry), ...docket, jurvioPath: null });
  }
  const argued = input.entries.filter((entry) => entry.filedOn && ARGUED.test(entry.description.trim()))
    .sort((a, b) => (a.filedOn ?? "").localeCompare(b.filedOn ?? ""))[0];
  if (argued?.filedOn) {
    steps.push({ key: "argued", date: argued.filedOn, title: "Oral argument",
      plain: "Lawyers for each side answered the Justices' questions in the courtroom.", quote: clip(argued.description), ...docket, jurvioPath: null });
  }
  if (input.judgmentOn) {
    steps.push({ key: "judgment", date: input.judgmentOn, title: "The Court decided the case",
      plain: "The Court's judgment is its final word on the case.", quote: clip(input.judgmentEntry), ...docket, jurvioPath: null });
  }
  if (application) {
    const ruling = input.entries.filter((entry) => entry.filedOn && APPLICATION_RULING.test(entry.description))
      .sort((a, b) => (b.filedOn ?? "").localeCompare(a.filedOn ?? ""))[0];
    if (ruling?.filedOn) {
      const word = APPLICATION_RULING.exec(ruling.description)?.[1]?.toLowerCase();
      steps.push({ key: "application-ruling", date: ruling.filedOn,
        title: word === "granted" ? "Application granted" : word === "denied" ? "Application denied" : "Application sent to the full Court",
        plain: word === "referred to the court" ? "The Justice asked all nine Justices to decide it." : "The record of the ruling on the emergency request.",
        quote: clip(ruling.description), ...docket, jurvioPath: null });
    }
  }
  return steps.sort((a, b) => a.date.localeCompare(b.date));
}

export interface JourneyBenchmarks {
  petitions: { lowerToFiling: Median; filingToCertDenied: Median; filingToJudgment: Median };
  applications: { held: number; filingToLatestEntry: Median };
  docketsHeld: number;
  earliestDocketed: string | null;
}
export interface Median { days: number | null; cases: number }

/** Gap from the previous dated step, in plain words. */
export function gapLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "same day";
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"} later`;
  if (days < 730) return `about ${Math.round(days / 30.44)} months later`;
  return `about ${(days / 365.25).toFixed(1)} years later`;
}

export function plainSpan(days: number | null): string {
  if (days === null) return "Not enough records";
  if (days < 60) return `${days} days`;
  if (days < 730) return `about ${Math.round(days / 30.44)} months`;
  return `about ${(days / 365.25).toFixed(1)} years`;
}
