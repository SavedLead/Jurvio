export type EvidenceEvent = {
  id: string;
  occurredOn: string;
  eventType: string;
  description: string;
  sourceUrl?: string | null;
  payload?: Record<string, unknown>;
};

export type IntelligenceAnswer = {
  answerKey: "ruling_outcome" | "current_status" | "latest_update";
  text: string;
  state: "verified" | "awaiting_deadline" | "court_update_unknown";
  confidence: number;
  asOf: string;
  refreshOn: string | null;
  evidenceIds: string[];
  ruleVersion: string;
};

const RULE_VERSION = "dismissal-amendment-v1";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function extractAmendmentDeadline(event: EvidenceEvent): string | null {
  const structured = event.payload?.amendmentDeadline;
  if (typeof structured === "string" && /^\d{4}-\d{2}-\d{2}$/.test(structured)) return structured;
  const text = event.description;
  const match = text.match(/(?:amend(?:ed)? complaint|leave to amend|file an amended complaint)[^.!\n]{0,100}?(?:by|before|no later than)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]} UTC`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function isDismissalWithLeave(event: EvidenceEvent): boolean {
  const text = `${event.eventType} ${event.description}`;
  return /dismiss/i.test(text) && /(without prejudice|leave to amend|amended complaint|may amend)/i.test(text);
}

export function deriveDismissalAmendmentAnswers(events: EvidenceEvent[], asOf: string): IntelligenceAnswer[] {
  const ordered = [...events].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const trigger = ordered.filter(isDismissalWithLeave).at(-1);
  if (!trigger) return [];
  const deadline = extractAmendmentDeadline(trigger);
  if (!deadline) return [];
  const later = ordered.filter((event) => event.occurredOn > trigger.occurredOn);
  const amended = later.find((event) => /(amended complaint|amendment filed)/i.test(`${event.eventType} ${event.description}`));
  const closed = later.find((event) => /(case closed|dismissed with prejudice|final judgment|judgment entered)/i.test(`${event.eventType} ${event.description}`));
  const ruling = `The court dismissed the complaint without prejudice and gave the plaintiff until ${formatDate(deadline)} to file an amended complaint.`;
  let status: IntelligenceAnswer;
  if (amended) {
    status = { answerKey: "current_status", text: `The plaintiff filed an amended complaint on ${formatDate(amended.occurredOn)}. Jurvio will continue updating the case as the court record changes.`, state: "verified", confidence: 0.99, asOf, refreshOn: null, evidenceIds: [trigger.id, amended.id], ruleVersion: RULE_VERSION };
  } else if (closed) {
    status = { answerKey: "current_status", text: `After the amendment opportunity, the court record shows ${closed.description.replace(/[.\s]+$/, "") } on ${formatDate(closed.occurredOn)}.`, state: "verified", confidence: 0.98, asOf, refreshOn: null, evidenceIds: [trigger.id, closed.id], ruleVersion: RULE_VERSION };
  } else if (asOf <= deadline) {
    status = { answerKey: "current_status", text: `The plaintiff has until ${formatDate(deadline)} to file an amended complaint. Jurvio has not yet identified a later court event.`, state: "awaiting_deadline", confidence: 0.99, asOf, refreshOn: deadline, evidenceIds: [trigger.id], ruleVersion: RULE_VERSION };
  } else {
    status = { answerKey: "current_status", text: `The plaintiff was given until ${formatDate(deadline)} to amend the complaint. That date has passed, but Jurvio does not yet have a later court entry showing what happened next.`, state: "court_update_unknown", confidence: 0.99, asOf, refreshOn: null, evidenceIds: [trigger.id], ruleVersion: RULE_VERSION };
  }
  const latest = ordered.at(-1)!;
  return [
    { answerKey: "ruling_outcome", text: ruling, state: "verified", confidence: 0.99, asOf, refreshOn: deadline, evidenceIds: [trigger.id], ruleVersion: RULE_VERSION },
    status,
    { answerKey: "latest_update", text: `${formatDate(latest.occurredOn)}: ${latest.description.replace(/[.\s]+$/, "")}.`, state: "verified", confidence: 0.99, asOf, refreshOn: status.refreshOn, evidenceIds: [latest.id], ruleVersion: RULE_VERSION },
  ];
}
