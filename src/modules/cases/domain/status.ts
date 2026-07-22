export const STATUS_RULE_VERSION = "federal-civil-v1";

export type ActivityState = "active" | "stayed" | "closed" | "reopened";
export type ProceduralPhase =
  | "filing"
  | "pleadings"
  | "discovery"
  | "dispositive_motions"
  | "trial"
  | "post_trial"
  | "appeal";
export type DispositionScope = "none" | "partial" | "complete";
export type JudgmentState = "none" | "entered" | "amended" | "stayed" | "vacated" | "satisfied";
export type AppealState = "unavailable" | "eligible" | "filed" | "active" | "resolved";
export type VerificationState = "verified" | "conflict" | "needs_review" | "not_verified";

export type StatusEventType =
  | "complaint_filed"
  | "answer_filed"
  | "discovery_opened"
  | "dispositive_motion_filed"
  | "motion_to_dismiss_denied"
  | "motion_to_dismiss_granted_partial"
  | "motion_to_dismiss_granted_complete"
  | "summary_judgment_granted_partial"
  | "summary_judgment_granted_complete"
  | "trial_started"
  | "judgment_entered"
  | "judgment_amended"
  | "judgment_stayed"
  | "judgment_vacated"
  | "notice_of_appeal_filed"
  | "appeal_resolved"
  | "case_stayed"
  | "case_reopened"
  | "case_dismissed"
  | "ambiguous";

export interface StatusEvent {
  id: string;
  type: StatusEventType;
  occurredOn: string;
  sourceLabel: string;
  scope?: "case" | "partial";
  detail?: string;
}

export interface CaseStatus {
  activity: ActivityState;
  phase: ProceduralPhase;
  disposition: DispositionScope;
  judgment: JudgmentState;
  appeal: AppealState;
  verification: VerificationState;
  triggeringEventId?: string;
  explanation: string;
  ruleVersion: string;
}

export const initialCaseStatus: CaseStatus = {
  activity: "active",
  phase: "filing",
  disposition: "none",
  judgment: "none",
  appeal: "unavailable",
  verification: "not_verified",
  explanation: "Status has not yet been verified from a qualifying court event.",
  ruleVersion: STATUS_RULE_VERSION,
};

function withEvent(
  current: CaseStatus,
  event: StatusEvent,
  patch: Partial<CaseStatus>,
  explanation: string,
): CaseStatus {
  return {
    ...current,
    ...patch,
    verification: "verified",
    triggeringEventId: event.id,
    explanation,
    ruleVersion: STATUS_RULE_VERSION,
  };
}

export function applyStatusEvent(current: CaseStatus, event: StatusEvent): CaseStatus {
  const date = event.occurredOn;
  switch (event.type) {
    case "complaint_filed":
      return withEvent(current, event, { activity: "active", phase: "filing" },
        `A complaint was filed on ${date}. The case is active. The allegations have not been proven.`);
    case "answer_filed":
      return withEvent(current, event, { activity: "active", phase: "pleadings" },
        `An answer was filed on ${date}. The case remains active in the pleadings stage.`);
    case "discovery_opened":
      return withEvent(current, event, { activity: "active", phase: "discovery" },
        `Discovery began on ${date}. The parties may exchange evidence under the court's rules and orders.`);
    case "dispositive_motion_filed":
      return withEvent(current, event, { activity: "active", phase: "dispositive_motions" },
        `A potentially case-resolving motion was filed on ${date}. The court has not yet decided that motion.`);
    case "motion_to_dismiss_denied":
      return withEvent(current, event, { activity: "active", phase: "pleadings" },
        `The court denied a motion to dismiss on ${date}. The case remains active. This ruling does not decide who ultimately wins.`);
    case "motion_to_dismiss_granted_partial":
    case "summary_judgment_granted_partial":
      return withEvent(current, event, { activity: "active", disposition: "partial", phase: "dispositive_motions" },
        `The court resolved part of the case on ${date}. Other claims or parties remain. This is not a complete final judgment.`);
    case "motion_to_dismiss_granted_complete":
    case "summary_judgment_granted_complete":
      return withEvent(current, event, { activity: "closed", disposition: "complete", phase: "post_trial" },
        `The court resolved all currently pending claims on ${date}. A separate judgment or appeal may still follow.`);
    case "trial_started":
      return withEvent(current, event, { activity: "active", phase: "trial" },
        `Trial began on ${date}. No final outcome should be inferred until a verdict or court decision is entered.`);
    case "judgment_entered":
      return withEvent(current, event, { activity: "closed", phase: "post_trial", disposition: "complete", judgment: "entered", appeal: "eligible" },
        `Judgment was entered on ${date}. Trial-court proceedings are substantially complete, subject to remaining post-judgment issues and appeal.`);
    case "judgment_amended":
      return withEvent(current, event, { judgment: "amended", appeal: "eligible" },
        `The judgment was amended on ${date}. The amended judgment controls unless it is later stayed, vacated, or changed on appeal.`);
    case "judgment_stayed":
      return withEvent(current, event, { judgment: "stayed" },
        `The judgment was stayed on ${date}. Enforcement is paused to the extent stated by the court.`);
    case "judgment_vacated":
      return withEvent(current, event, { activity: "active", judgment: "vacated", disposition: "none" },
        `The judgment was vacated on ${date}. It no longer has its prior effect, and further proceedings may be required.`);
    case "notice_of_appeal_filed":
      return withEvent(current, event, { phase: "appeal", appeal: "active" },
        `A notice of appeal was filed on ${date}. The appellate court has not yet resolved the appeal.`);
    case "appeal_resolved":
      return withEvent(current, event, { appeal: "resolved" },
        `The appeal was resolved on ${date}. Review the appellate disposition and any remand instructions for the current effect.`);
    case "case_stayed":
      return withEvent(current, event, { activity: "stayed" },
        `The case was stayed on ${date}. Proceedings are paused to the extent stated by the court.`);
    case "case_reopened":
      return withEvent(current, event, { activity: "reopened" },
        `The case was reopened on ${date}. Further trial-court proceedings may occur.`);
    case "case_dismissed":
      return withEvent(current, event, { activity: "closed", disposition: event.scope === "partial" ? "partial" : "complete" },
        event.scope === "partial"
          ? `Part of the case was dismissed on ${date}. Other claims or parties remain.`
          : `The case was dismissed on ${date}. The effect on refiling depends on the dismissal order.`);
    case "ambiguous":
      return {
        ...current,
        verification: "needs_review",
        triggeringEventId: event.id,
        explanation: "A source event is ambiguous. Jurvio has not changed the verified status pending review.",
        ruleVersion: STATUS_RULE_VERSION,
      };
  }
}

export function replayStatus(events: readonly StatusEvent[]): CaseStatus {
  return [...events]
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id))
    .reduce(applyStatusEvent, initialCaseStatus);
}
