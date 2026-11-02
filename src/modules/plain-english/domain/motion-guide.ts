/**
 * Plain-English guide to every motion on a trial court's public docket
 * (case-depth feature 6). Rule-based: a fixed list of motion kinds, each with a
 * plain explanation, and rulings tied to motions only by the docket number the
 * order cites. Sealed, restricted, ex parte and in camera entries are skipped.
 * No AI. A paid language model could later explain unusual motions this list
 * does not know; that needs David's OK and is not built.
 */
import { motionType, readRulings, type DocketEntryInput, type DocketRuling } from "@/modules/plain-english/domain/relief";

export interface MotionKindInfo { key: string; label: string; plain: string }

/** Order matters: the first rule that matches wins, so specific phrases come first. */
const KINDS: Array<{ test: RegExp } & MotionKindInfo> = [
  { key: "partial-summary-judgment", test: /\bpartial\s+summary\s+judgment\b/, label: "Partial summary judgment", plain: "Asks the judge to decide part of the case now, without a trial, because the key facts on that part are not really in dispute." },
  { key: "summary-judgment", test: /\bsummary\s+judgment\b/, label: "Summary judgment", plain: "Asks the judge to decide the case without a trial, because the key facts are not really in dispute and the law favors the side asking." },
  { key: "pleadings", test: /\bjudgment\s+on\s+the\s+pleadings\b/, label: "Judgment on the pleadings", plain: "Asks the judge to decide the case using only the written complaint and answer." },
  { key: "jmol", test: /\bjudgment\s+as\s+a\s+matter\s+of\s+law\b/, label: "Judgment as a matter of law", plain: "Asks the judge to decide for one side because no reasonable jury could decide otherwise on the evidence." },
  { key: "default-judgment", test: /\bdefault\s+judgment\b/, label: "Default judgment", plain: "Asks the court to rule for one side because the other side never responded to the case." },
  { key: "entry-of-default", test: /\bentry\s+of\s+default\b|\bclerk['’]?s?\s+entry\s+of\s+default\b/, label: "Entry of default", plain: "Asks the clerk to record that a party missed its deadline to respond. It is a step before a default judgment." },
  { key: "new-trial", test: /\bnew\s+trial\b/, label: "New trial", plain: "Asks for the case to be tried again, usually because of a serious error at the first trial." },
  { key: "reconsideration", test: /\breconsider(?:ation)?\b|\balter\s+or\s+amend\s+(?:the\s+)?judgment\b/, label: "Reconsideration", plain: "Asks the judge to look again at a decision already made and change it." },
  { key: "preliminary-injunction", test: /\bpreliminary\s+injunction\b/, label: "Preliminary injunction", plain: "Asks the court to order someone to do, or stop doing, something while the case is still going on." },
  { key: "tro", test: /\btemporary\s+restraining\s+order\b|\btro\b/, label: "Temporary restraining order", plain: "Asks for a short emergency order, often for days, until the court can hold a fuller hearing." },
  { key: "class-certification", test: /\bclass\s+certification\b|\bcertify\s+(?:a\s+|the\s+)?class\b/, label: "Class certification", plain: "Asks the court to let the case go forward on behalf of a whole group of people with the same claim (a class action)." },
  { key: "remand", test: /\bto\s+remand\b|\bremand\s+to\s+state\b/, label: "Remand", plain: "Asks a federal court to send the case back to the state court where it started." },
  { key: "transfer", test: /\bto\s+transfer\b|\bchange\s+(?:of\s+)?venue\b/, label: "Transfer", plain: "Asks to move the case to a different court, often one closer to the people or events involved." },
  { key: "consolidate", test: /\bconsolidat/, label: "Consolidate", plain: "Asks the court to combine this case with related cases so they are handled together." },
  { key: "habeas", test: /\bhabeas\s+corpus\b/, label: "Habeas corpus", plain: "Asks the court to order a prisoner's release or a new proceeding because the detention is unlawful." },
  { key: "vacate-sentence", test: /\b2255\b|\bvacate,?\s+set\s+aside,?\s+or\s+correct\b/, label: "Vacate a federal sentence", plain: "Asks the court to throw out or correct a federal prison sentence (under 28 U.S.C. § 2255)." },
  { key: "compassionate-release", test: /\bcompassionate\s+release\b|\breduction\s+(?:in|of)\s+sentence\b|\b3582\b/, label: "Sentence reduction", plain: "Asks the court to shorten a prison sentence, for example for serious illness or a change in the law." },
  { key: "suppress", test: /\bto\s+suppress\b/, label: "Suppress evidence", plain: "Asks the court to keep certain evidence out of the trial, usually because it was gathered illegally." },
  { key: "limine", test: /\bin\s+limine\b/, label: "Motion in limine", plain: "Asks the judge, before trial, to decide whether certain evidence may be shown to the jury." },
  { key: "dismiss", test: /\bto\s+dismiss\b|\bdismissal\b/, label: "Dismiss", plain: "Asks the court to end the case (or part of it) early, often because even if everything claimed were true, the law would not allow the claim." },
  { key: "strike", test: /\bto\s+strike\b/, label: "Strike", plain: "Asks the court to remove something from the record, such as part of a filing." },
  { key: "compel", test: /\bto\s+compel\b/, label: "Compel", plain: "Asks the court to order the other side to hand over information or do something it has refused to do, usually in discovery (the evidence-sharing stage)." },
  { key: "protective-order", test: /\bprotective\s+order\b/, label: "Protective order", plain: "Asks the court to limit how information shared in the case can be used, or to limit what must be shared." },
  { key: "quash", test: /\bto\s+quash\b/, label: "Quash", plain: "Asks the court to cancel a subpoena (an order to testify or hand over documents)." },
  { key: "sanctions", test: /\bsanctions?\b/, label: "Sanctions", plain: "Asks the court to penalize a party or lawyer for breaking the rules, for example with a fine." },
  { key: "fees", test: /\battorney['’]?s?\s+fees\b|\bcosts\b/, label: "Attorney's fees or costs", plain: "Asks the court to make the other side pay legal fees or court costs." },
  { key: "stay", test: /\bto\s+stay\b|\bstay\s+(?:of\s+)?(?:proceedings|discovery|the\s+case|pending)\b/, label: "Stay", plain: "Asks the court to pause the case, or part of it, for a while." },
  { key: "amend", test: /\bleave\s+to\s+(?:file\s+(?:an?\s+|a\s+second\s+|a\s+third\s+)?)?amend|\bto\s+amend\b/, label: "Amend", plain: "Asks permission to change an earlier filing, such as the complaint." },
  { key: "intervene", test: /\bto\s+intervene\b|\bintervention\b/, label: "Intervene", plain: "Someone not yet in the case asks to join it because the outcome affects them." },
  { key: "extend-time", test: /\bextension\s+of\s+time\b|\bextend\s+(?:the\s+)?(?:time|deadline)|\benlarge(?:ment)?\s+(?:of\s+)?time\b/, label: "More time", plain: "Asks for more time to meet a deadline." },
  { key: "continuance", test: /\bcontinu(?:ance|e)\b|\bto\s+reschedule\b|\badjourn/, label: "Postpone", plain: "Asks to move a hearing, trial, or other date to later." },
  { key: "ifp", test: /\bin\s+forma\s+pauperis\b|\bwithout\s+prepay/, label: "Proceed without paying fees", plain: "Asks to bring the case without paying court fees because the person cannot afford them (in forma pauperis)." },
  { key: "appoint-counsel", test: /\bappoint(?:ment)?\s+(?:of\s+)?counsel\b/, label: "Appoint a lawyer", plain: "Asks the court to appoint a lawyer for someone who does not have one." },
  { key: "withdraw-counsel", test: /\bwithdraw\s+as\s+(?:attorney|counsel)\b|\bwithdrawal\s+of\s+(?:attorney|counsel)\b/, label: "Lawyer withdraws", plain: "A lawyer asks permission to stop representing a party in the case." },
  { key: "pro-hac-vice", test: /\bpro\s+hac\s+vice\b/, label: "Out-of-state lawyer", plain: "Asks permission for a lawyer not admitted in this court to work on this one case (pro hac vice)." },
  { key: "substitute", test: /\bto\s+substitute\b|\bsubstitution\b/, label: "Substitute", plain: "Asks to replace one party or lawyer in the case with another." },
  { key: "leave-to-file", test: /\bleave\s+to\s+file\b/, label: "Permission to file", plain: "Asks permission to file a document the rules would not otherwise allow, such as an extra or late brief." },
];

const RESTRICTED = /\bseal(?:ed|ing)?\b|\brestricted\b|\bex\s+parte\b|\bin\s+camera\b|\bunder\s+seal\b/i;

export function motionKind(text: string): MotionKindInfo | null {
  const value = text.toLowerCase();
  for (const kind of KINDS) if (kind.test.test(value)) return { key: kind.key, label: kind.label, plain: kind.plain };
  return null;
}

export type MotionStatus = "granted" | "denied" | "partly" | "moot" | "no-ruling-shown";

export interface PlainMotion {
  /** How the ruling was tied to this motion: the order cites its docket number, or it is the only order of that type. */
  rulingMatchedBy: "docket-number" | "only-matching-order" | null;
  entryNumber: number | null;
  entryPublicId: string | null;
  filedOn: string | null;
  kind: MotionKindInfo;
  by: string | null;
  text: string;
  status: MotionStatus;
  rulingOn: string | null;
  rulingEntryNumber: number | null;
  rulingText: string | null;
}

export interface MotionGuideEntry extends DocketEntryInput { publicId?: string | null }

function clean(text: string) { return text.replace(/\s+/g, " ").trim(); }

function numberOf(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

const MOTION_HEAD = /^(?:(?:joint|amended|renewed|second|third|partial|cross|emergency|unopposed|opposed|consent|supplemental|consented|expedited)\s+)*(?:MOTION|APPLICATION|PETITION)\s+(?:for|to|in)\s+([^(]{3,200})/i;

/** Read one docket entry as a motion, or null. */
export function readPlainMotion(entry: MotionGuideEntry): Omit<PlainMotion, "status" | "rulingOn" | "rulingEntryNumber" | "rulingText" | "rulingMatchedBy"> | null {
  const text = clean(entry.description ?? "");
  if (!text || text.length > 1500 || RESTRICTED.test(text)) return null;
  const head = MOTION_HEAD.exec(text);
  if (!head) return null;
  const kind = motionKind(head[0]);
  if (!kind) return null;
  const by = /\b(?:filed\s+)?by\s+([A-Z][A-Za-z0-9.,&' -]{1,80}?)(?:\.\s|\.?$|\s*\(|,\s+(?:filed|responses?|attachments?))/.exec(text.slice(head.index + 8));
  return {
    entryNumber: numberOf(entry.entryNumber), entryPublicId: entry.publicId ?? null, filedOn: entry.filedOn, kind,
    by: by?.[1]?.trim().replace(/[,;]\s*$/, "") ?? null,
    text: text.length > 320 ? `${text.slice(0, 317).replace(/\s+\S*$/, "")}…` : text,
  };
}

/**
 * Every readable motion on the docket, newest first, each with the ruling an
 * order ties to it by docket number. Without a cited number we do not guess.
 */
export function buildMotionGuide(entries: MotionGuideEntry[]): PlainMotion[] {
  const rulings = entries.flatMap((entry) => readRulings(entry));
  const motions = entries.map((entry) => readPlainMotion(entry)).filter((motion): motion is NonNullable<typeof motion> => Boolean(motion));
  const typeOf = (text: string) => motionType(text);
  const used = new Set<DocketRuling>();
  const out: PlainMotion[] = [];
  for (const motion of motions) {
    let matchedBy: PlainMotion["rulingMatchedBy"] = null;
    let ruling = motion.entryNumber !== null
      ? rulings.filter((item) => item.refersTo === motion.entryNumber).sort((a, b) => (b.filedOn ?? "").localeCompare(a.filedOn ?? ""))[0]
      : undefined;
    if (ruling) matchedBy = "docket-number";
    const type = typeOf(motion.text);
    if (!ruling && type) {
      // Same rule as the relief summary: an order that names the motion type but no number is tied to a motion
      // only when it is the only motion of that type and the only such uncited order filed on or after it.
      const sameType = motions.filter((other) => typeOf(other.text) === type);
      const candidates = rulings.filter((item) => item.refersTo === null && item.type === type && !used.has(item)
        && (!motion.filedOn || !item.filedOn || item.filedOn >= motion.filedOn));
      if (sameType.length === 1 && candidates.length === 1) { ruling = candidates[0]; matchedBy = "only-matching-order"; }
    }
    if (ruling) used.add(ruling);
    out.push({
      ...motion,
      status: ruling ? ruling.result : "no-ruling-shown",
      rulingOn: ruling?.filedOn ?? null,
      rulingEntryNumber: ruling?.entryNumber ?? null,
      rulingText: ruling?.quote ?? null,
      rulingMatchedBy: matchedBy,
    });
  }
  return out.sort((a, b) => (b.filedOn ?? "").localeCompare(a.filedOn ?? "") || (b.entryNumber ?? 0) - (a.entryNumber ?? 0));
}

export const STATUS_PLAIN: Record<MotionStatus, string> = {
  granted: "Granted: the judge agreed.",
  denied: "Denied: the judge said no.",
  partly: "Granted in part and denied in part.",
  moot: "Not decided: the judge called it moot, meaning it no longer mattered.",
  "no-ruling-shown": "No ruling on it appears in the docket entries Jurvio holds.",
};
