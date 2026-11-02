/**
 * How a federal district civil case ended, in plain English, from the Federal
 * Judicial Center Integrated Database (IDB) codes the clerk's office reports:
 * DISP (disposition) and JUDGMENT (which side the judgment was for).
 * Codebook: https://www.fjc.gov/research/idb (civil, 1988-present).
 */
import type { PartyRoles } from "./party-roles";
import { displayPartyName } from "./party-roles";

export interface FjcOutcomeSignal {
  terminatedOn: string | null;
  disposition: number | null;
  /** 1 plaintiff, 2 defendant, 3 both, 4 unknown. */
  judgment: number | null;
  plaintiff: string | null;
  defendant: string | null;
  snapshotDate: string | null;
}

export const FJC_IDB_URL = "https://www.fjc.gov/research/idb";

export interface FjcOutcomeText {
  headline: string;
  label: string;
  text: string;
}

const JUDGMENT_DISPOSITIONS = new Set([4, 5, 6, 7, 8, 9, 15]);

const HOW_DECIDED: Record<number, string> = {
  4: "by default judgment (the defendant did not respond to the lawsuit)",
  5: "by consent judgment (a judgment both sides agreed to)",
  6: "on a motion before trial (for example, summary judgment)",
  7: "by a jury verdict",
  8: "by a directed verdict (the judge decided during a jury trial)",
  9: "by the judge after a bench trial (a trial without a jury)",
  15: "by an arbitrator's award",
};

const NO_RULING: Record<number, { headline: string; text: string }> = {
  0: { headline: "The case was transferred to another federal court.", text: "The court transferred the case to another federal court, so it continued there. This court did not decide who was right." },
  10: { headline: "The case was transferred to a multidistrict litigation (MDL) court.", text: "The case was transferred to a multidistrict litigation (MDL) court, which handles many similar cases together. This court did not decide who was right." },
  1: { headline: "The case was sent back (remanded) to state court.", text: "The federal court sent the case back (remanded it) to state court, so it continued there. The federal court did not decide who was right." },
  11: { headline: "The case was sent back to a federal agency.", text: "The court sent the case back (remanded it) to a federal agency for more work." },
  12: { headline: "The case was voluntarily dismissed (dropped) without a court ruling.", text: "No one won in court. The plaintiff voluntarily dismissed the case (dropped it, often because of a settlement) without a court decision on who was right." },
  13: { headline: "The case was settled.", text: "No one won in court. The parties settled the case, and the court closed it without deciding who was right." },
  16: { headline: "The case was put on hold because of a bankruptcy.", text: "The case was stayed (put on hold) because a party filed for bankruptcy, and the court closed it. The court did not decide who was right." },
  17: { headline: "This case is closed, but the court records we have don't say how it ended.", text: "The court statistics list this case as closed for \"other\" reasons and don't say how it ended or who won." },
  18: { headline: "The court closed this case for administrative reasons.", text: "The court closed the case for administrative reasons (a statistical closing). That is not a ruling on who was right, and the case can be reopened." },
};

/** Whether the IDB's first-listed plaintiff matches our caption's first side, its second side, or neither. */
function alignment(roles: PartyRoles | null, plaintiff: string | null, defendant: string | null): "same" | "swapped" | "unknown" {
  if (!roles) return "unknown";
  const token = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .find((word) => word.length >= 4 && !/^(?:united|states|america|the|inc|corp|company|county|city|state|department|unknown)$/.test(word)) ?? null;
  const left = roles.up.name.toLowerCase();
  const right = roles.down.name.toLowerCase();
  const p = token(plaintiff);
  const d = token(defendant);
  const pLeft = p ? left.includes(p) : false;
  const pRight = p ? right.includes(p) : false;
  const dLeft = d ? left.includes(d) : false;
  const dRight = d ? right.includes(d) : false;
  const forward = pLeft || dRight;
  const backward = pRight || dLeft;
  if (forward && !backward) return "same";
  if (backward && !forward) return "swapped";
  return "unknown";
}

export function fjcOutcomeText(signal: FjcOutcomeSignal, roles: PartyRoles | null): FjcOutcomeText | null {
  const code = signal.disposition;
  if (code === null) return null;
  if (roles?.up.role === "prosecution") return null; // the IDB rows we match are civil cases
  const aligned = alignment(roles, signal.plaintiff, signal.defendant);
  const plaintiffName = aligned === "same" ? displayPartyName(roles!.up.name) : aligned === "swapped" ? displayPartyName(roles!.down.name) : null;
  const defendantName = aligned === "same" ? displayPartyName(roles!.down.name) : aligned === "swapped" ? displayPartyName(roles!.up.name) : null;
  const plaintiff = plaintiffName ? `${plaintiffName} (the plaintiff)` : "the plaintiff";
  const defendant = defendantName ? `${defendantName} (the defendant)` : "the defendant";

  if (JUDGMENT_DISPOSITIONS.has(code)) {
    const how = HOW_DECIDED[code] ?? "";
    if (signal.judgment === 1) {
      return { headline: `The court ruled for ${plaintiff}.`, label: "Who won?",
        text: `${capitalize(plaintiff)}. The court entered judgment (its final decision) for the plaintiff ${how}, against ${defendant}.` };
    }
    if (signal.judgment === 2) {
      return { headline: `The court ruled for ${defendant}.`, label: "Who won?",
        text: `${capitalize(defendant)}. The court entered judgment (its final decision) for the defendant ${how}, against ${plaintiff}.` };
    }
    if (signal.judgment === 3) {
      return { headline: "The court ruled partly for each side.", label: "Who won?",
        text: `Each side won part. The court entered judgment (its final decision) ${how}, partly for ${plaintiff} and partly for ${defendant}.` };
    }
    return { headline: `The court decided the case ${how.replace(/ \(.*\)$/, "")}.`, label: "Who won?",
      text: `The court decided the case ${how}. The court statistics don't say which side the judgment was for.` };
  }
  if (code === 2) {
    return { headline: "The court dismissed the case because the plaintiff did not pursue it.", label: "How did it end?",
      text: `The court dismissed the case for want of prosecution (the plaintiff stopped pursuing it). That is a loss for ${plaintiff}, though not a ruling on who was right.` };
  }
  if (code === 3) {
    return { headline: "The court dismissed the case because it lacked jurisdiction (the power to hear it).", label: "How did it end?",
      text: `The court dismissed the case for lack of jurisdiction (it did not have the power to hear it). That is not a ruling on who was right; ${plaintiff} may be able to bring the claims in another court.` };
  }
  if (code === 14) {
    return { headline: "The court dismissed the case.", label: "How did it end?",
      text: `The court dismissed the case (threw it out). That is a loss for ${plaintiff}. The court statistics don't say why it was dismissed.` };
  }
  if (code === 19 || code === 20) {
    return { headline: code === 19 ? "The court affirmed (upheld) a magistrate judge's decision." : "The court denied an appeal from a magistrate judge's decision.", label: "How did it end?",
      text: code === 19 ? "The court affirmed (agreed with and upheld) the decision of a magistrate judge." : "The court denied the appeal from a magistrate judge's decision, leaving that decision in place." };
  }
  const other = NO_RULING[code];
  if (other) return { headline: other.headline, label: "How did it end?", text: other.text };
  return null;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
