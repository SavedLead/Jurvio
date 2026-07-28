export const STATUS_RULE_VERSION = "federal-civil-v2";

export type ActivityState = "active" | "stayed" | "closed" | "reopened";
export type ProceduralPhase = "filing" | "pleadings" | "discovery" | "dispositive_motions" | "trial" | "post_trial" | "appeal";
export type DispositionScope = "none" | "partial" | "complete";
export type JudgmentState = "none" | "entered" | "amended" | "stayed" | "vacated" | "satisfied";
export type AppealState = "unavailable" | "eligible" | "filed" | "active" | "resolved";
export type VerificationState = "verified" | "conflict" | "needs_review" | "not_verified";

export type StatusEventType =
  | "complaint_filed" | "answer_filed" | "discovery_opened" | "dispositive_motion_filed"
  | "motion_to_dismiss_denied" | "motion_to_dismiss_granted_partial" | "motion_to_dismiss_granted_complete"
  | "summary_judgment_granted_partial" | "summary_judgment_granted_complete" | "trial_started"
  | "judgment_entered" | "judgment_amended" | "judgment_stayed" | "judgment_vacated"
  | "notice_of_appeal_filed" | "appeal_resolved" | "case_stayed" | "case_reopened"
  | "case_dismissed" | "ambiguous";

export interface StatusEvent {
  id: string;
  type: StatusEventType;
  occurredOn: string;
  sourceLabel: string;
  sourceUri: string;
  verifiedAt: string;
  scope?: "case" | "partial";
  detail?: string;
}

export interface StatusEvidence {
  eventId: string;
  label: string;
  uri: string;
  occurredOn: string;
  verifiedAt: string;
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
  fact: string;
  proceduralPossibilities: string[];
  prediction: null;
  source: StatusEvidence | null;
  reviewReason: string | null;
  ruleVersion: string;
}

export const initialCaseStatus: CaseStatus = {
  activity: "active", phase: "filing", disposition: "none", judgment: "none", appeal: "unavailable",
  verification: "not_verified", explanation: "Status has not yet been verified from a qualifying court event.",
  fact: "No current case status has been verified.", proceduralPossibilities: [], prediction: null,
  source: null, reviewReason: null, ruleVersion: STATUS_RULE_VERSION,
};

function evidence(event: StatusEvent): StatusEvidence {
  return { eventId: event.id, label: event.sourceLabel, uri: event.sourceUri, occurredOn: event.occurredOn, verifiedAt: event.verifiedAt };
}

function withEvent(current: CaseStatus, event: StatusEvent, patch: Partial<CaseStatus>, fact: string, proceduralPossibilities: string[] = []): CaseStatus {
  return { ...current, ...patch, verification: "verified", triggeringEventId: event.id, explanation: fact, fact,
    proceduralPossibilities, prediction: null, source: evidence(event), reviewReason: null, ruleVersion: STATUS_RULE_VERSION };
}

export function applyStatusEvent(current: CaseStatus, event: StatusEvent): CaseStatus {
  const date = event.occurredOn;
  switch (event.type) {
    case "complaint_filed": return withEvent(current,event,{activity:"active",phase:"filing"},`A complaint was filed on ${date}. The allegations have not been proven.`,["A response, motion, or other filing may follow under the applicable rules or a court order."]);
    case "answer_filed": return withEvent(current,event,{activity:"active",phase:"pleadings"},`An answer was filed on ${date}. The case remains active in the pleadings stage.`,["The court may set scheduling, discovery, or motion deadlines."]);
    case "discovery_opened": return withEvent(current,event,{activity:"active",phase:"discovery"},`Discovery began on ${date}.`,["The parties may exchange evidence subject to governing rules and court orders."]);
    case "dispositive_motion_filed": return withEvent(current,event,{activity:"active",phase:"dispositive_motions"},`A potentially case-resolving motion was filed on ${date}. The court has not decided it.`,["The opposing party may respond, and the court may grant, deny, narrow, defer, or otherwise resolve the motion."]);
    case "motion_to_dismiss_denied": return withEvent(current,event,{activity:"active",phase:"pleadings"},`The court denied a motion to dismiss on ${date}. This ruling does not decide who ultimately prevails.`,["Pleadings, discovery, another motion, settlement, or trial proceedings may follow."]);
    case "motion_to_dismiss_granted_partial":
    case "summary_judgment_granted_partial": return withEvent(current,event,{activity:"active",disposition:"partial",phase:"dispositive_motions"},`The court resolved part of the case on ${date}. Other claims or parties remain.`,["Proceedings may continue on the unresolved claims or parties."]);
    case "motion_to_dismiss_granted_complete":
    case "summary_judgment_granted_complete": return withEvent(current,event,{activity:"closed",disposition:"complete",phase:"post_trial"},`The court resolved all currently pending claims on ${date}.`,["A separate judgment, a qualifying post-judgment motion, or an appeal may follow."]);
    case "trial_started": return withEvent(current,event,{activity:"active",phase:"trial"},`Trial began on ${date}. No outcome has been entered.`,["A verdict, findings, settlement, mistrial, or other court action may follow."]);
    case "judgment_entered": return withEvent(current,event,{activity:"closed",phase:"post_trial",disposition:"complete",judgment:"entered",appeal:"eligible"},`Judgment was entered on ${date}.`,["A qualifying post-judgment motion or appeal may be available; deadlines depend on the governing rules and orders."]);
    case "judgment_amended": return withEvent(current,event,{judgment:"amended",appeal:"eligible"},`The judgment was amended on ${date}.`,["The amended judgment controls unless later stayed, vacated, or changed through further proceedings."]);
    case "judgment_stayed": return withEvent(current,event,{judgment:"stayed"},`The judgment was stayed on ${date}.`,["Enforcement is paused only to the extent stated by the court."]);
    case "judgment_vacated": return withEvent(current,event,{activity:"active",judgment:"vacated",disposition:"none"},`The judgment was vacated on ${date} and no longer has its prior effect.`,["Further proceedings may be required under the vacatur order."]);
    case "notice_of_appeal_filed": return withEvent(current,event,{phase:"appeal",appeal:"active"},`A notice of appeal was filed on ${date}. The appeal has not been resolved.`,["Appellate briefing, argument, dismissal, decision, or remand may follow."]);
    case "appeal_resolved": return withEvent(current,event,{appeal:"resolved"},`The appeal was resolved on ${date}.`,["Any further proceedings depend on the appellate disposition and remand instructions."]);
    case "case_stayed": return withEvent(current,event,{activity:"stayed"},`The case was stayed on ${date}.`,["Proceedings may resume only as permitted by a later order or the terms of the stay."]);
    case "case_reopened": return withEvent(current,event,{activity:"reopened"},`The case was reopened on ${date}.`,["Further trial-court proceedings may occur."]);
    case "case_dismissed": return withEvent(current,event,{activity:event.scope==="partial"?"active":"closed",disposition:event.scope==="partial"?"partial":"complete"},event.scope==="partial"?`Part of the case was dismissed on ${date}. Other claims or parties remain.`:`The case was dismissed on ${date}.`,["The effect on refiling, judgment, or appeal depends on the dismissal order and governing law."]);
    case "ambiguous": return { ...current, verification:"needs_review", triggeringEventId:event.id, proceduralPossibilities:[], prediction:null,
      reviewReason:`The event labeled “${event.sourceLabel}” could not be mapped without interpretation.`, ruleVersion:STATUS_RULE_VERSION };
  }
}

export function replayStatus(events: readonly StatusEvent[]): CaseStatus {
  return [...events].sort((a,b)=>a.occurredOn.localeCompare(b.occurredOn)||a.id.localeCompare(b.id)).reduce(applyStatusEvent,initialCaseStatus);
}
