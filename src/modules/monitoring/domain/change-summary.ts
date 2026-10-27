// Milestone M4, Phase B (ADR 0077): deterministic change summary for alerts.
//
// The approved first paid product requires every alert to state WHAT HAPPENED, WHY IT MATTERS,
// WHAT CHANGED, WHAT REMAINS UNRESOLVED, and WHAT MAY HAPPEN NEXT (docs/18 §4). This renders that
// from the deterministic status engine ONLY -- no AI, no prediction of outcomes -- so an alert is
// always sourced and reproducible. AI narrative is an additive Phase E layer, never the source of
// a status claim (docs/26 §5). Templates are factual and neutral; they never give legal advice.

import type { CaseStatus, StatusEvent, StatusEventType } from "@/modules/cases/domain/status";

export interface ChangeSummary {
  whatHappened: string;
  whyItMatters: string;
  whatChanged: string;
  unresolved: string;
  whatNext: string;
  sourceLabel: string;
  ruleVersion: string;
}

const ACTIVITY_LABEL: Record<CaseStatus["activity"], string> = {
  active: "active",
  stayed: "paused (stayed)",
  closed: "closed",
  reopened: "reopened",
};

const PHASE_LABEL: Record<CaseStatus["phase"], string> = {
  filing: "initial filing",
  pleadings: "pleadings",
  discovery: "discovery",
  dispositive_motions: "dispositive motions",
  trial: "trial",
  post_trial: "post-trial",
  appeal: "appeal",
};

const DISPOSITION_LABEL: Record<CaseStatus["disposition"], string> = {
  none: "no claims resolved",
  partial: "some claims resolved",
  complete: "all claims resolved",
};

const JUDGMENT_LABEL: Record<CaseStatus["judgment"], string> = {
  none: "no judgment",
  entered: "judgment entered",
  amended: "judgment amended",
  stayed: "judgment stayed",
  vacated: "judgment vacated",
  satisfied: "judgment satisfied",
};

const APPEAL_LABEL: Record<CaseStatus["appeal"], string> = {
  unavailable: "appeal not yet available",
  eligible: "appeal available",
  filed: "appeal filed",
  active: "appeal in progress",
  resolved: "appeal resolved",
};

interface EventNarrative {
  happened: string;
  matters: string;
  next: string;
}

// Factual, neutral narrative per deterministic event type. No outcome prediction, no advice.
const EVENT_NARRATIVE: Record<StatusEventType, EventNarrative> = {
  complaint_filed: {
    happened: "A complaint was filed, opening the case.",
    matters: "This begins the litigation and sets the parties and claims on the record.",
    next: "The defendants are expected to answer or move to dismiss.",
  },
  answer_filed: {
    happened: "An answer to the complaint was filed.",
    matters: "The defense has responded, joining the dispute on the record.",
    next: "The case typically proceeds toward discovery.",
  },
  discovery_opened: {
    happened: "The case entered discovery.",
    matters: "The parties now exchange evidence and information.",
    next: "Dispositive motions often follow the close of discovery.",
  },
  dispositive_motion_filed: {
    happened: "A dispositive motion was filed.",
    matters: "A party is asking the court to decide part or all of the case without trial.",
    next: "The court will rule on the motion after briefing.",
  },
  motion_to_dismiss_denied: {
    happened: "A motion to dismiss was denied.",
    matters: "The challenged claims survive and the case continues.",
    next: "The case typically proceeds toward discovery or further motions.",
  },
  motion_to_dismiss_granted_partial: {
    happened: "A motion to dismiss was granted in part.",
    matters: "Some claims were dismissed while others remain.",
    next: "The surviving claims continue through the case.",
  },
  motion_to_dismiss_granted_complete: {
    happened: "A motion to dismiss was granted in full.",
    matters: "All challenged claims were dismissed.",
    next: "The case may close unless amended or appealed.",
  },
  summary_judgment_granted_partial: {
    happened: "Summary judgment was granted in part.",
    matters: "The court resolved some claims without trial; others remain.",
    next: "The remaining claims continue toward resolution.",
  },
  summary_judgment_granted_complete: {
    happened: "Summary judgment was granted in full.",
    matters: "The court resolved the remaining claims without trial.",
    next: "Judgment may be entered, and an appeal may follow.",
  },
  trial_started: {
    happened: "Trial began.",
    matters: "The case is being decided on the merits at trial.",
    next: "A verdict and judgment are expected to follow.",
  },
  judgment_entered: {
    happened: "Judgment was entered.",
    matters: "The court has entered a decision resolving the case.",
    next: "An appeal may be filed within the applicable deadline.",
  },
  judgment_amended: {
    happened: "The judgment was amended.",
    matters: "The terms of the court's decision were changed.",
    next: "Appeal deadlines may run from the amended judgment.",
  },
  judgment_stayed: {
    happened: "The judgment was stayed.",
    matters: "Enforcement of the judgment is paused for now.",
    next: "The stay will be lifted or the matter resolved by further order.",
  },
  judgment_vacated: {
    happened: "The judgment was vacated.",
    matters: "The prior decision no longer stands.",
    next: "The case may resume or be re-decided.",
  },
  notice_of_appeal_filed: {
    happened: "A notice of appeal was filed.",
    matters: "A party is challenging the decision in a higher court.",
    next: "The appeal will be briefed and decided by the appellate court.",
  },
  appeal_resolved: {
    happened: "The appeal was resolved.",
    matters: "The appellate court has ruled.",
    next: "The case may close, or return to the lower court on remand.",
  },
  case_stayed: {
    happened: "The case was stayed.",
    matters: "Proceedings are paused for now.",
    next: "The case resumes when the stay is lifted.",
  },
  case_reopened: {
    happened: "The case was reopened.",
    matters: "A closed case is active again.",
    next: "Proceedings resume from the reopened posture.",
  },
  case_dismissed: {
    happened: "The case was dismissed.",
    matters: "The case ended without reaching a full judgment on the merits.",
    next: "The dismissal may be appealed, or the case refiled if without prejudice.",
  },
  ambiguous: {
    happened: "A court entry was recorded that could not be classified deterministically.",
    matters: "The entry may affect the case, but its effect is not yet certain.",
    next: "The entry is re-evaluated as the record clarifies.",
  },
};

function describeStatusDelta(prev: CaseStatus, next: CaseStatus): string {
  const parts: string[] = [];
  if (prev.activity !== next.activity) {
    parts.push(`case is now ${ACTIVITY_LABEL[next.activity]} (was ${ACTIVITY_LABEL[prev.activity]})`);
  }
  if (prev.phase !== next.phase) {
    parts.push(`phase moved to ${PHASE_LABEL[next.phase]} (from ${PHASE_LABEL[prev.phase]})`);
  }
  if (prev.disposition !== next.disposition) {
    parts.push(`${DISPOSITION_LABEL[next.disposition]} (was ${DISPOSITION_LABEL[prev.disposition]})`);
  }
  if (prev.judgment !== next.judgment) {
    parts.push(`${JUDGMENT_LABEL[next.judgment]} (was ${JUDGMENT_LABEL[prev.judgment]})`);
  }
  if (prev.appeal !== next.appeal) {
    parts.push(`${APPEAL_LABEL[next.appeal]} (was ${APPEAL_LABEL[prev.appeal]})`);
  }
  if (parts.length === 0) return "No change to the overall case status.";
  return `${parts.join("; ")}.`;
}

function describeUnresolved(next: CaseStatus): string {
  const open: string[] = [];
  if (next.activity === "stayed") open.push("the case is currently paused");
  if (next.disposition !== "complete" && next.activity !== "closed") {
    open.push("not all claims are resolved yet");
  }
  if (next.appeal === "filed" || next.appeal === "active") open.push("an appeal is pending");
  if (open.length === 0) return "Nothing further appears outstanding on the record.";
  return `${open.join("; ")}.`;
}

/**
 * Build the deterministic five-part change summary for a status transition. `event.detail`, when
 * present, replaces the default "what happened" line so a specific court entry can be quoted.
 */
export function summarizeStatusChange(
  prev: CaseStatus,
  next: CaseStatus,
  event: StatusEvent,
): ChangeSummary {
  const narrative = EVENT_NARRATIVE[event.type];
  const whatHappened = event.detail && event.detail.trim().length > 0
    ? event.detail.trim()
    : narrative.happened;
  return {
    whatHappened,
    whyItMatters: narrative.matters,
    whatChanged: describeStatusDelta(prev, next),
    unresolved: describeUnresolved(next),
    whatNext: narrative.next,
    sourceLabel: event.sourceLabel,
    ruleVersion: next.ruleVersion,
  };
}
