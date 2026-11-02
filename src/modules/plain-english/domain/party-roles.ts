/**
 * Who is on which side of a case, read only from the record: the opinion's
 * own caption block ("YONG JUAN ZHAO, Plaintiff-Appellee, v. UNITED STATES OF
 * AMERICA, Defendant-Appellant."), the Supreme Court's "CERTIORARI TO …" line,
 * structured party roles, or (for trial courts) the case caption itself.
 * When the record does not say, the result is null; nothing is guessed.
 */
import type { CourtKind } from "@/modules/cases/domain/record-answers";

export type ReviewRole = "appellant" | "appellee" | "petitioner" | "respondent";
export type TrialRole = "plaintiff" | "defendant" | "prosecution";

export interface PartySide {
  /** Display name, from the case caption (cleaned). */
  name: string;
  /** Role in the court that decided this case. */
  role: ReviewRole | TrialRole;
  /** Role in the trial court, when the opinion caption states it ("Plaintiff-Appellee"). */
  trialRole: TrialRole | null;
}

export interface PartyRoles {
  /** The side that asked for review (appellant / petitioner), or the plaintiff in a trial court. */
  up: PartySide;
  /** The other side (appellee / respondent), or the defendant in a trial court. */
  down: PartySide;
  /** Both sides appealed (cross-appeals): who "won" is not one side. */
  cross: boolean;
  source: "opinion" | "court-record" | "caption";
}

const DASH = String.raw`[\s\-‐‑–—/]+`;
const TRIAL = String.raw`(?:Plaintiffs?|Defendants?|Petitioners?|Respondents?|Claimants?|Counter-?\s?(?:Plaintiffs?|Defendants?)|Intervenors?|Movants?|Debtors?|Creditors?)`;
const REVIEW = String.raw`(?:Appellants?|Appellees?|Petitioners?|Respondents?)`;
const CROSS = String.raw`(?:${DASH}|,\s*)(?:and\s+)?Cross${DASH}?(?:Appellants?|Appellees?|Petitioners?|Respondents?)`;
const ROLE_LABEL = new RegExp(String.raw`(?:^|[,.;\s])((?:${TRIAL}${DASH})?(${REVIEW})(?:${CROSS})?)(?=[\s.,;]|$)`, "gi");

function reviewRole(word: string): ReviewRole {
  const lower = word.toLowerCase();
  if (lower.startsWith("appellant")) return "appellant";
  if (lower.startsWith("appellee")) return "appellee";
  if (lower.startsWith("petitioner")) return "petitioner";
  return "respondent";
}

function trialRoleOf(label: string): TrialRole | null {
  const lower = label.toLowerCase();
  if (/^(?:counter-?\s?)?plaintiff/.test(lower) || /^claimant/.test(lower)) return "plaintiff";
  if (/^(?:counter-?\s?)?defendant/.test(lower)) return "defendant";
  return null;
}

/** "Yong Juan Zhao v. USA" -> ["Yong Juan Zhao", "USA"]; null for "In re …" or no "v.". */
export function captionSides(caption: string): [string, string] | null {
  const parts = caption.replace(/\s+/g, " ").trim().split(/\s+(?:v\.?|vs\.?)\s+/i);
  if (parts.length !== 2) return null;
  const [left, right] = parts.map((part) => (part ?? "").replace(/[,;]\s*$/, "").trim());
  if (!left || !right || /^(?:in re|ex parte|matter of|in the matter of)\b/i.test(left)) return null;
  return [left, right];
}

const US_NAME = /^(?:the\s+)?(?:USA|U\.\s?S\.\s?A?\.?|United States(?: of America)?)$/i;

/** Readable party name for a sentence: "USA" -> "the United States"; long names keep the first party. */
export function displayPartyName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (US_NAME.test(trimmed)) return "the United States";
  if (/^(?:the\s+)?people of the state of /i.test(trimmed) || /^state of /i.test(trimmed)) return trimmed.replace(/^the\s+/i, "the ").replace(/^(?!the )/i, "the ");
  const shortened = trimmed.replace(/,?\s+et al\.?$/i, "").replace(/\s*,\s*(?:et al|etc)\.?$/i, "");
  const display = shortened.length > 70 ? `${shortened.slice(0, 67).replace(/\s+\S*$/, "")}…` : shortened;
  return /,?\s+et al\.?$/i.test(trimmed) ? `${display} and others` : display;
}

function significantWords(name: string): string[] {
  if (US_NAME.test(name.trim())) return ["united", "usa"];
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((word) => word.length >= 3 && !["the", "and", "inc", "corp", "llc", "co", "company", "ltd", "et", "al", "of", "for", "state", "city", "county", "people"].includes(word));
}

function mentions(block: string, name: string): boolean {
  const lower = block.toLowerCase();
  const words = significantWords(name);
  return words.length > 0 && words.some((word) => lower.includes(word));
}

/**
 * Read the review roles from the caption block at the top of an appellate
 * opinion. The block must put one caption party before "v." and the other after
 * it, each followed by a role label; otherwise null.
 */
export function readOpinionCaptionRoles(head: string | null | undefined, caption: string): PartyRoles | null {
  if (!head) return null;
  const sides = captionSides(caption);
  if (!sides) return null;
  const text = head.slice(0, 5000).replace(/\s+/g, " ");
  const versus = /(?:^|[\s,.])v\.?(?=\s)/gi;
  let match: RegExpExecArray | null;
  while ((match = versus.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 700), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 700);
    const leftLabels = [...before.matchAll(ROLE_LABEL)];
    const leftLabel = leftLabels.at(-1);
    ROLE_LABEL.lastIndex = 0;
    const rightLabel = [...after.matchAll(ROLE_LABEL)][0];
    if (!leftLabel?.[1] || !leftLabel[2] || !rightLabel?.[1] || !rightLabel[2]) continue;
    // The left label must close the left party's block (nothing else between it and "v.").
    const tailAfterLabel = before.slice((leftLabel.index ?? 0) + leftLabel[0].length);
    if (tailAfterLabel.replace(/[\s.,;]/g, "").length > 0) continue;
    const leftBlock = before.slice(0, leftLabel.index);
    const rightBlock = after.slice(0, rightLabel.index);
    const [first, second] = sides;
    if (!mentions(leftBlock, first) || !mentions(rightBlock, second)) continue;
    const leftRole = reviewRole(leftLabel[2]);
    const rightRole = reviewRole(rightLabel[2]);
    const upRoles: ReviewRole[] = ["appellant", "petitioner"];
    const leftUp = upRoles.includes(leftRole);
    const rightUp = upRoles.includes(rightRole);
    if (leftUp === rightUp) return null;
    const cross = /cross/i.test(leftLabel[1]) || /cross/i.test(rightLabel[1]);
    const leftSide: PartySide = { name: first, role: leftRole, trialRole: trialRoleOf(leftLabel[1]) };
    const rightSide: PartySide = { name: second, role: rightRole, trialRole: trialRoleOf(rightLabel[1]) };
    return { up: leftUp ? leftSide : rightSide, down: leftUp ? rightSide : leftSide, cross, source: "opinion" };
  }
  return null;
}

/**
 * Supreme Court: the opinion text says how the case came up ("CERTIORARI TO THE
 * UNITED STATES COURT OF APPEALS FOR THE NINTH CIRCUIT", "APPEAL FROM …"). In
 * those cases the Court's caption names the party seeking review first.
 */
export function readSupremeRoles(head: string | null | undefined, caption: string, verifiedDocket: boolean): { roles: PartyRoles | null; lowerCourt: string | null } {
  const sides = captionSides(caption);
  const text = (head ?? "").slice(0, 6000).replace(/\s+/g, " ");
  const cert = /\b(?:ON\s+WRIT\s+OF\s+)?CERTIORARI\s+TO\s+(THE\s+[A-Z][A-Z .,'’&-]{5,160}?)(?=\s+No\.|\s+Argued|\s+Syllabus|\s+[A-Z][a-z]|\s*$|\s*\[)/.exec(text);
  const appeal = cert ? null : /\bAPPEALS?\s+FROM\s+(THE\s+[A-Z][A-Z .,'’&-]{5,160}?)(?=\s+No\.|\s+Argued|\s+Syllabus|\s+[A-Z][a-z]|\s*$|\s*\[)/.exec(text);
  const lowerCourt = cleanCourtLine((cert ?? appeal)?.[1] ?? null);
  if (!sides || (!cert && !appeal && !verifiedDocket)) return { roles: null, lowerCourt };
  const [first, second] = sides;
  const upRole: ReviewRole = appeal ? "appellant" : "petitioner";
  const downRole: ReviewRole = appeal ? "appellee" : "respondent";
  return {
    roles: {
      up: { name: first, role: upRole, trialRole: null },
      down: { name: second, role: downRole, trialRole: null },
      cross: false,
      source: cert || appeal ? "opinion" : "court-record",
    },
    lowerCourt,
  };
}

function titleCase(value: string) {
  const small = new Set(["of", "the", "for", "and", "in", "at", "on"]);
  return value.toLowerCase().split(/\s+/).map((word, index) => (index > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

function cleanCourtLine(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.replace(/[\s.,]+$/, "").trim();
  if (trimmed.length < 8 || trimmed.length > 160) return null;
  return /[a-z]/.test(trimmed) ? trimmed : titleCase(trimmed).replace(/^The /, "the ");
}

/** "Appeal from the United States District Court for the Southern District of Illinois" in an appellate opinion. */
export function readAppealedFrom(head: string | null | undefined): string | null {
  const text = (head ?? "").slice(0, 5000).replace(/\s+/g, " ");
  const match = /\b(?:Appeals?|On\s+appeal)\s+from\s+(?:a\s+judgment\s+of\s+|an\s+order\s+of\s+)?(the\s+United\s+States\s+(?:District|Bankruptcy)\s+Court\s+for\s+the\s+[A-Z][A-Za-z .]{3,60}?)(?=[.,;]|\s+No\.|\s+at\s+|\s+[A-Z][a-z]+,?\s+(?:Chief\s+)?(?:District\s+)?Judge|\s+\d)/i.exec(text)
    ?? /\bPetitions?\s+for\s+Review\s+(?:of\s+an?\s+)?(?:Order|Decision)s?\s+of\s+(the\s+[A-Z][A-Za-z .,'&-]{5,100}?)(?=[.;]|\s+No\.|\s+Agency|\s+\d)/i.exec(text);
  return cleanCourtLine(match?.[1] ?? null);
}

/** Trial courts: the caption itself is "Plaintiff v. Defendant" ("United States v. X" in a criminal case). */
export function trialCaptionRoles(caption: string): PartyRoles | null {
  const sides = captionSides(caption);
  if (!sides) return null;
  const [first, second] = sides;
  const prosecution = US_NAME.test(first.trim()) || /^(?:the\s+)?(?:people|state|commonwealth)\b/i.test(first.trim());
  return {
    up: { name: first, role: prosecution ? "prosecution" : "plaintiff", trialRole: prosecution ? "prosecution" : "plaintiff" },
    down: { name: second, role: "defendant", trialRole: "defendant" },
    cross: false,
    source: "caption",
  };
}

export const ROLE_WORD: Record<ReviewRole | TrialRole, string> = {
  appellant: "appellant",
  appellee: "appellee",
  petitioner: "petitioner",
  respondent: "respondent",
  plaintiff: "plaintiff",
  defendant: "defendant",
  prosecution: "prosecution",
};

/** Which caption side a name in a docket entry ("judgment in favor of Acme Corp.") refers to. */
export function sideForName(roles: PartyRoles, name: string): "up" | "down" | null {
  const lower = name.toLowerCase();
  if (/\bplaintiffs?\b/.test(lower) && !/\bdefendants?\b/.test(lower)) return roles.up.role === "plaintiff" ? "up" : null;
  if (/\bdefendants?\b/.test(lower) && !/\bplaintiffs?\b/.test(lower)) return roles.down.role === "defendant" ? "down" : null;
  const up = mentions(name, roles.up.name) || mentions(roles.up.name, name);
  const down = mentions(name, roles.down.name) || mentions(roles.down.name, name);
  if (up === down) return null;
  return up ? "up" : "down";
}

export function partyRolesFor(courtKind: CourtKind, input: { caption: string; opinionHead: string | null; verifiedDocket: boolean }): { roles: PartyRoles | null; lowerCourt: string | null } {
  if (courtKind === "supreme") return readSupremeRoles(input.opinionHead, input.caption, input.verifiedDocket);
  if (courtKind === "appellate") return { roles: readOpinionCaptionRoles(input.opinionHead, input.caption), lowerCourt: readAppealedFrom(input.opinionHead) };
  return { roles: trialCaptionRoles(input.caption), lowerCourt: null };
}
