export const LEGAL_TERM_DEFINITIONS = {
  "dismissed with prejudice":
    "The claim was ended and generally cannot be filed again in the same court.",
  "dismissed without prejudice":
    "The claim was ended, but it may be filed again if the legal or procedural problem can be corrected.",
  jurisdiction:
    "A court's legal authority to hear and decide a particular kind of dispute.",
  "summary judgment":
    "A decision made without a trial when the court determines that no important fact is genuinely disputed and the law controls the result.",
  disposition:
    "The way a court resolved all or part of a case, claim, or request.",
  appeal:
    "A request asking a higher court to review a lower court's decision.",
} as const;

export type LegalTerm = keyof typeof LEGAL_TERM_DEFINITIONS;

export interface CaseStatusInput {
  activityState: string;
  proceduralPhase: string;
  dispositionScope: string;
  judgmentState: string;
  appealState: string;
  verification: string;
  statusExplanation: string | null;
}

function readable(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

export function presentCaseStatus(input: CaseStatusInput) {
  if (input.verification !== "verified" || !input.statusExplanation) {
    return {
      headline: "Current status not yet verified",
      explanation:
        "Jurvio has not found a qualifying court event that safely establishes the current status.",
      verified: false,
    };
  }

  return {
    headline: input.activityState === "active" ? "Case appears active" : "Case status: " + readable(input.activityState),
    explanation: input.statusExplanation,
    verified: true,
  };
}

export function readableStatusValue(value: string) {
  if (value === "none" || value === "unavailable") return "Not shown in the verified record";
  return readable(value);
}
