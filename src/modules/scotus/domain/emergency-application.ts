/**
 * Supreme Court emergency applications ("26A624"): what kind of request each
 * one is, what each docket line means in plain English, and the application's
 * state (pending, referred, response due, administrative stay, ruled), read
 * only from the Court's own public docket lines. Nothing is inferred beyond
 * the Court's fixed phrasing; an unknown line is "other activity", never a
 * guess. Pure functions; no I/O.
 *
 * Privacy: callers pass only docket lines that already passed the strict
 * sealed/restricted word filter (isRestrictedDocketText). A line that was
 * withheld is counted, never read, so nothing here can surface it.
 */
import { parseDocketJusticeNotes, type JusticeNoteKind } from "./docket-justice-notes";
import { circuitJusticeForCircuit, circuitOfCourtName, ALLOTMENT, type CircuitId } from "./circuit-justice";

export const EMERGENCY_PARSER_VERSION = "scotus-emergency-v1";

export type ApplicationKind =
  | "extension" // more time to file a petition (routine; hidden by default)
  | "stay"
  | "stay_of_execution"
  | "injunction"
  | "vacate_stay"
  | "bail"
  | "other";

export type ApplicantKind = "federal" | "state" | "private";

export type ApplicationStatus = "pending" | "granted" | "granted_in_part" | "denied" | "withdrawn" | "moot" | "converted";

export type ApplicationEventKind =
  | "submitted"
  | "resubmitted"
  | "referred"
  | "response_requested"
  | "administrative_stay"
  | "response_filed"
  | "reply_filed"
  | "amicus_filed"
  | "granted"
  | "granted_in_part"
  | "denied"
  | "withdrawn"
  | "moot"
  | "converted"
  | "letter"
  | "other";

export const APPLICATION_KIND_LABEL: Readonly<Record<ApplicationKind, string>> = {
  extension: "Extension of time",
  stay: "Stay",
  stay_of_execution: "Stay of execution",
  injunction: "Injunction",
  vacate_stay: "Vacate a stay",
  bail: "Bail or release",
  other: "Other request",
};

export const APPLICANT_KIND_LABEL: Readonly<Record<ApplicantKind, string>> = {
  federal: "Federal government",
  state: "State or local government",
  private: "Private party",
};

export const STATUS_LABEL: Readonly<Record<ApplicationStatus, string>> = {
  pending: "Pending",
  granted: "Granted",
  granted_in_part: "Granted in part",
  denied: "Denied",
  withdrawn: "Withdrawn",
  moot: "Ended as moot",
  converted: "Turned into a full case",
};

export const EVENT_LABEL: Readonly<Record<ApplicationEventKind, string>> = {
  submitted: "Application filed",
  resubmitted: "Sent to another justice",
  referred: "Referred to the full Court",
  response_requested: "Response requested",
  administrative_stay: "Administrative stay",
  response_filed: "Response filed",
  reply_filed: "Reply filed",
  amicus_filed: "Amicus brief filed",
  granted: "Granted",
  granted_in_part: "Granted in part",
  denied: "Denied",
  withdrawn: "Withdrawn",
  moot: "Ended as moot",
  converted: "Turned into a full case",
  letter: "Letter filed",
  other: "Other docket activity",
};

/** Plain English for a reader who is not a lawyer, one line per event kind. */
export const EVENT_PLAIN: Readonly<Record<ApplicationEventKind, string>> = {
  submitted: "Someone asked the Supreme Court for emergency help, usually to pause or allow a lower court's order while the case continues.",
  resubmitted: "The request was sent again, this time to a different justice.",
  referred: "The justice assigned to this region passed the decision to all nine justices. This is often only visible when the ruling comes out.",
  response_requested: "The justice asked the other side to answer by a deadline. A ruling usually comes after that.",
  administrative_stay: "A short, temporary pause so the justices have time to decide. It says nothing about who will win.",
  response_filed: "The other side has answered the request.",
  reply_filed: "The applicant has replied to the other side's answer. A ruling can come any time now.",
  amicus_filed: "An outside group filed its views. The number of these briefs shows how much attention the case has.",
  granted: "The request was granted. This decides only what happens while the case continues; it is not the final word on the legal question.",
  granted_in_part: "The request was granted in part. This decides only what happens while the case continues; it is not the final word on the legal question.",
  denied: "The request was denied. This decides only what happens while the case continues; it is not the final word on the legal question.",
  withdrawn: "The applicant withdrew the request, so there will be no ruling on it.",
  moot: "The request ended without a ruling because it no longer mattered (it became moot).",
  converted: "The Court turned this emergency request into a full case it will hear and decide on the merits.",
  letter: "A party sent the Court a letter.",
  other: "Something else was entered on the docket. See the Court's own wording below.",
};

/** Extension rulings use the same "granted" words but are routine; plain English says so. */
const EXTENSION_PLAIN: Partial<Record<ApplicationEventKind, string>> = {
  submitted: "A party asked for more time to file a petition asking the Supreme Court to review a lower-court decision. This is routine.",
  granted: "The justice gave the party more time to file. This is routine and says nothing about the case itself.",
  denied: "The justice refused to give the party more time to file.",
};

export function plainEnglishFor(kind: ApplicationEventKind, applicationKind: ApplicationKind | null): string {
  return (applicationKind === "extension" ? EXTENSION_PLAIN[kind] : undefined) ?? EVENT_PLAIN[kind];
}

/** Docket years: "26A624" -> { year: 26, number: 624 }. */
export function parseApplicationNumber(value: string | null | undefined): { year: number; number: number } | null {
  const match = /^(\d{2})A(\d{1,4})$/i.exec((value ?? "").trim());
  return match ? { year: Number(match[1]), number: Number(match[2]) } : null;
}

export function normalizeApplicationNumber(value: string | null | undefined): string | null {
  const parsed = parseApplicationNumber(value);
  return parsed ? `${String(parsed.year).padStart(2, "0")}A${parsed.number}` : null;
}

const JUSTICE_NAME = String.raw`(?:The\s+Chief\s+Justice|Justice\s+[A-Z][A-Za-z'’\-]+)`;

function justiceRef(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (/^The\s+Chief\s+Justice$/i.test(text)) return "The Chief Justice";
  const match = /^Justice\s+(.+)$/.exec(text);
  return match?.[1] ? match[1].trim() : null;
}

/** One docket line -> event kind. Ruling words are checked before "referred", since a ruling line says both. */
export function classifyApplicationEvent(description: string): ApplicationEventKind {
  const text = description.replace(/\s+/g, " ").trim();
  if (/\b(?:construed|treated)\s+as\s+a\s+petition\b|\bcertiorari\s+before\s+judgment\s+(?:is\s+)?granted\b|\bset\s+for\s+(?:oral\s+)?argument\b/i.test(text)) return "converted";
  if (/^Application\b[^.]*\bwithdrawn\b|\bletter\b[^.]*\bwithdraw(?:ing|s)?\s+(?:the\s+)?application\b/i.test(text) && !/\bmotion\b/i.test(text.slice(0, 20))) return "withdrawn";
  if (/\b(?:denied|dismissed)\s+as\s+moot\b/i.test(text)) return "moot";
  if (/\badministrative(?:ly)?\s+stay(?:ed)?\b/i.test(text)
    || new RegExp(String.raw`^Order\s+entered\s+by\s+${JUSTICE_NAME}\b[^.]*\bstayed\s+pending\s+further\s+order`, "i").test(text)
    || /\bis\s+(?:hereby\s+)?stayed\s+pending\s+further\s+order\s+of\s+the\s+(?:undersigned|Chief\s+Justice|Court)\b/i.test(text)) return "administrative_stay";
  if (/^Application\b[^.]*\b(?:is\s+)?granted\s+in\s+part\b/i.test(text)) return "granted_in_part";
  if (/^Application\b[^.]*\b(?:is\s+)?granted\b/i.test(text)) return "granted";
  if (/^Application\b[^.]*\b(?:is\s+)?denied\b/i.test(text)) return "denied";
  if (/^Application\b[^.]*\breferred\s+to\s+the\s+Court\b/i.test(text)) return "referred";
  if (/^Response\s+to\s+application\b[^.]*\brequested\s+by\b/i.test(text) || /^(?:The\s+)?response\s+(?:to\s+the\s+application\s+)?(?:is\s+)?requested\b/i.test(text)) return "response_requested";
  if (/^Response\s+to\s+application\b[^.]*\bfiled\b/i.test(text) || /^(?:Opposition|Memorandum)\s+[^.]*\bto\s+(?:the\s+)?application\b[^.]*\bfiled\b/i.test(text)) return "response_filed";
  if (/^Reply\b[^.]*\b(?:filed|submitted)\b/i.test(text)) return "reply_filed";
  if (/^Brief\s+amic(?:us|i)\s+curiae\b/i.test(text)) return "amicus_filed";
  if (/^Application\b[^.]*\b(?:re-?submitted|renewed)\b/i.test(text) || /^Renewed\s+application\b/i.test(text)) return "resubmitted";
  if (/^Application\b[^.]*\bsubmitted\s+to\b/i.test(text)) return "submitted";
  if (/^Letter\b/i.test(text)) return "letter";
  return "other";
}

/** What the application asks for, from its first ("Application ... submitted to Justice X") line. */
export function classifyApplicationKind(firstLine: string | null | undefined, capital = false): ApplicationKind {
  const text = (firstLine ?? "").replace(/\s+/g, " ");
  if (/\bto\s+extend\s+the\s+time\b|\bextension\s+of\s+time\b|\bextend(?:ing)?\s+the\s+time\s+to\s+file\b/i.test(text)) return "extension";
  if (/\bstay\s+of\s+execution\b|\bsentence\s+of\s+death\b/i.test(text)) return "stay_of_execution";
  if (/\bvacate\b[^.]{0,60}\bstay\b/i.test(text)) return "vacate_stay";
  if (/\binjunction\b/i.test(text) && !/\bstay\b[^.]{0,40}\binjunction\b/i.test(text)) return "injunction";
  if (/\b(?:bail|release\s+pending|release\s+from\s+custody)\b/i.test(text)) return "bail";
  if (/\bstay\b/i.test(text)) return capital && /\bexecution\b/i.test(text) ? "stay_of_execution" : "stay";
  return "other";
}

const FEDERAL_CAPTION = /^(?:United\s+States\b(?!\s+(?:ex\s+rel|Fidelity|Steel|Airlines?|Postal\s+Service\s+v))|(?:Donald\s+J\.\s+)?Trump,\s+President\b|President\s+of\s+the\s+United\s+States|(?:[A-Z][\w.’'-]*\s+){0,4}(?:Secretary|Attorney\s+General\s+of\s+the\s+United\s+States|Administrator|Commissioner|Director)\b[^,]*(?:,\s*(?:et\s+al\.?))?\s*$|Department\s+of\s+|Office\s+of\s+Personnel\s+Management|(?:Federal|National)\s+[A-Z][a-z]+\s+(?:Commission|Board|Agency|Administration)|Securities\s+and\s+Exchange\s+Commission|Internal\s+Revenue\s+Service|Social\s+Security\s+Administration|Small\s+Business\s+Administration|U\.\s?S\.\s+(?:Department|Immigration|Customs))/i;
const STATE_NAMES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia", "Puerto Rico"];
const STATE_CAPTION = new RegExp(String.raw`^(?:(?:State|Commonwealth)\s+of\s+)?(?:${STATE_NAMES.join("|")})(?:\s*,\s*et\s+al\.?)?\s*$|^(?:City|County|Town|Village|Board|School\s+District)\b|\b(?:Governor|Attorney\s+General|Secretary\s+of\s+State)\s+of\s+(?:${STATE_NAMES.join("|")})\b|\b(?:Warden|Director,\s+[A-Z][a-z]+\s+Department\s+of\s+Corrections)\b`, "i");

/**
 * Who filed. `applicant` is the caption's first party; `solicitorGeneral` is
 * true when the applicant's counsel of record is the Solicitor General (read
 * by the caller from the docket page; never stored).
 */
export function classifyApplicant(applicant: string | null | undefined, solicitorGeneral = false): ApplicantKind {
  const name = (applicant ?? "").replace(/\s+/g, " ").replace(/,\s*Applicants?\.?$/i, "").trim();
  if (solicitorGeneral || FEDERAL_CAPTION.test(name)) return "federal";
  if (STATE_CAPTION.test(name)) return "state";
  return "private";
}

/** The administration a date falls in (applications are filed by date). */
export function administrationOn(date: string | null | undefined): string | null {
  if (!date) return null;
  if (date >= "2025-01-20") return "Trump (second term)";
  if (date >= "2021-01-20") return "Biden";
  if (date >= "2017-01-20") return "Trump (first term)";
  if (date >= "2009-01-20") return "Obama";
  return null;
}

/** "Response to application (24A904) requested by Justice Kagan, due by 12 p.m. (EDT) on April 3, 2025." */
export function parseResponseDue(description: string): { dueOn: string | null; dueText: string | null; justice: string | null } {
  const text = description.replace(/\s+/g, " ");
  const justice = justiceRef(new RegExp(String.raw`requested\s+by\s+(${JUSTICE_NAME})`, "i").exec(text)?.[1]);
  const due = /\bdue\s+(?:by\s+)?((?:\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\.?\s*(?:\([A-Z]{2,4}\))?\s*(?:on\s+)?)?([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}))/i.exec(text);
  return { dueOn: due?.[2] ? longDate(due[2]) : null, dueText: due?.[1]?.replace(/\s+/g, " ").trim() ?? null, justice };
}

function longDate(value: string): string | null {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value.trim());
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf((match[1] ?? "").toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${(match[2] ?? "").padStart(2, "0")}`;
}

/** "submitted to Justice Kagan" / "presented to The Chief Justice" -> "Kagan" / "The Chief Justice". */
export function submittedJustice(description: string): string | null {
  const match = new RegExp(String.raw`\b(?:submitted|presented|resubmitted|re-submitted)\s+to\s+(${JUSTICE_NAME})`, "i").exec(description.replace(/\s+/g, " "));
  return justiceRef(match?.[1]);
}

/** The circuit justice's docket name ("Kagan", "The Chief Justice") for a lower court's name, when it is a federal court of appeals. */
export function expectedJusticeFor(lowerCourt: string | null | undefined): { circuit: CircuitId; justiceRef: string; justiceName: string; justiceSlug: string } | null {
  const circuit = circuitOfCourtName(lowerCourt);
  const assigned = circuitJusticeForCircuit(circuit);
  if (!circuit || !assigned) return null;
  const ref = assigned.title === "Chief Justice" ? "The Chief Justice" : assigned.justiceName.replace(/,?\s+Jr\.$/, "").split(/\s+/).at(-1)!;
  return { circuit, justiceRef: ref, justiceName: assigned.justiceName, justiceSlug: assigned.justiceSlug };
}

/** Docket name -> justice page slug for the current Court ("Kagan" -> "elena-kagan"). */
export function justiceSlugForRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (/chief/i.test(ref)) return ALLOTMENT.find((row) => row.title === "Chief Justice")?.justiceSlug ?? null;
  const surname = ref.trim().toLowerCase();
  return ALLOTMENT.find((row) => row.justiceName.replace(/,?\s+Jr\.$/, "").split(/\s+/).at(-1)!.toLowerCase() === surname)?.justiceSlug ?? null;
}

export interface DocketLine {
  /** Stable id shared with docket_entry.provider_entry_id ("26A624:event:2026-11-02:1"). */
  sourceRecordId: string;
  filedOn: string | null;
  description: string;
}

export interface ApplicationEvent extends DocketLine {
  kind: ApplicationEventKind;
  plain: string;
  /** Justices the line names in a position ("would grant", "dissenting"), docket refs. */
  justices: string[];
}

export interface NotedVote { justiceRef: string; position: "would_grant" | "would_deny" | "dissent" | "concurrence" | "statement" | "recused"; sentence: string }

export interface ApplicationState {
  kind: ApplicationKind;
  status: ApplicationStatus;
  submittedOn: string | null;
  submittedJustice: string | null;
  referredOn: string | null;
  responseDueOn: string | null;
  responseDueText: string | null;
  responseRequestedBy: string | null;
  adminStayOn: string | null;
  adminStayJustice: string | null;
  rulingOn: string | null;
  /** "court" when the full Court ruled (referred first), "justice" when one justice did. */
  ruledBy: "court" | "justice" | null;
  /** True when the ruling line carries more than the bare result (the Court gave reasons). */
  writtenReasons: boolean;
  notedVotes: NotedVote[];
  amicusCount: number;
  lastEntryOn: string | null;
  events: ApplicationEvent[];
}

const RULING_KINDS: ReadonlySet<ApplicationEventKind> = new Set(["granted", "granted_in_part", "denied", "withdrawn", "moot", "converted"]);

function voteKind(kind: JusticeNoteKind): NotedVote["position"] | null {
  switch (kind) {
    case "would_grant": return "would_grant";
    case "would_deny": return "would_deny";
    case "dissent": case "joined_dissent": return "dissent";
    case "concurrence": case "joined_concurrence": return "concurrence";
    case "statement": case "joined_statement": return "statement";
    case "recused": return "recused";
    default: return null;
  }
}

/** The application's state from its (already privacy-filtered) docket lines, oldest first. */
export function deriveApplicationState(lines: readonly DocketLine[], options: { capital?: boolean } = {}): ApplicationState {
  const first = lines.find((line) => /^Application\b/i.test(line.description)) ?? lines[0] ?? null;
  const kind = classifyApplicationKind(first?.description, options.capital);
  const state: ApplicationState = {
    kind, status: "pending", submittedOn: null, submittedJustice: null, referredOn: null,
    responseDueOn: null, responseDueText: null, responseRequestedBy: null, adminStayOn: null, adminStayJustice: null,
    rulingOn: null, ruledBy: null, writtenReasons: false, notedVotes: [], amicusCount: 0, lastEntryOn: null, events: [],
  };
  for (const line of lines) {
    const eventKind = classifyApplicationEvent(line.description);
    const notes = parseDocketJusticeNotes(line.description);
    state.events.push({ ...line, kind: eventKind, plain: plainEnglishFor(eventKind, kind), justices: [...new Set(notes.map((note) => note.justiceRef))] });
    if (line.filedOn && (!state.lastEntryOn || line.filedOn > state.lastEntryOn)) state.lastEntryOn = line.filedOn;
    switch (eventKind) {
      case "submitted":
        state.submittedOn ??= line.filedOn;
        state.submittedJustice ??= submittedJustice(line.description);
        break;
      case "resubmitted":
        state.submittedJustice = submittedJustice(line.description) ?? state.submittedJustice;
        break;
      case "referred":
        state.referredOn ??= line.filedOn;
        break;
      case "response_requested": {
        const due = parseResponseDue(line.description);
        state.responseDueOn = due.dueOn;
        state.responseDueText = due.dueText;
        state.responseRequestedBy = due.justice;
        break;
      }
      case "administrative_stay":
        state.adminStayOn ??= line.filedOn;
        state.adminStayJustice ??= justiceRef(new RegExp(String.raw`(${JUSTICE_NAME})`).exec(line.description)?.[1]);
        break;
      case "amicus_filed":
        state.amicusCount += 1;
        break;
      default:
        break;
    }
    if (RULING_KINDS.has(eventKind)) {
      state.status = eventKind === "granted" ? "granted" : eventKind === "granted_in_part" ? "granted_in_part" : eventKind as ApplicationStatus;
      state.rulingOn = line.filedOn;
      if (eventKind === "granted" || eventKind === "granted_in_part" || eventKind === "denied") {
        state.ruledBy = state.referredOn || /\breferred\s+to\s+the\s+Court\b|\bThe\s+Court\b/i.test(line.description) ? "court" : "justice";
        if (/\breferred\s+to\s+the\s+Court\b/i.test(line.description)) state.referredOn ??= line.filedOn;
        const bare = line.description.split(/(?<=\b(?:granted|denied)(?:\s+in\s+part)?\.)\s+/i);
        state.writtenReasons = bare.length > 1 && bare.slice(1).join(" ").replace(/\b(?:The\s+Chief\s+)?Justices?\s[^.]*\b(?:would|dissent|concur|took\s+no\s+part)[^.]*\./gi, "").trim().length > 40;
      }
      for (const note of parseDocketJusticeNotes(line.description)) {
        const position = voteKind(note.kind);
        if (position && !state.notedVotes.some((vote) => vote.justiceRef === note.justiceRef && vote.position === position)) {
          state.notedVotes.push({ justiceRef: note.justiceRef, position, sentence: note.sentence });
        }
      }
    }
  }
  return state;
}

/** Serious = everything except routine extensions of time. */
export function isSerious(kind: ApplicationKind): boolean {
  return kind !== "extension";
}

export type PollTier = "hot" | "open" | "routine" | "closed" | "retired";

/**
 * How often to re-read an application's docket page:
 * hot (administrative stay in place or response deadline passed, still pending) and
 * open serious: every run (about every 10 minutes); pending extensions and
 * serious applications quiet for 60 days: daily;
 * decided: daily for 30 days (late opinions, rehearing), then never.
 */
export function pollTier(input: { kind: ApplicationKind; status: ApplicationStatus; adminStayOn: string | null; responseDueOn: string | null; rulingOn: string | null; lastEntryOn?: string | null }, today: string): PollTier {
  if (input.status === "pending") {
    if (!isSerious(input.kind)) return "routine";
    if (input.adminStayOn || (input.responseDueOn && input.responseDueOn <= today && daysApart(input.responseDueOn, today) <= 60)) return "hot";
    // Quiet for two months (held, or its ruling was a withheld line): daily is enough.
    if (input.lastEntryOn && daysApart(input.lastEntryOn, today) > 60) return "routine";
    return "open";
  }
  if (input.rulingOn && daysApart(input.rulingOn, today) > 30) return "retired";
  return "closed";
}

export const TIER_INTERVAL_MINUTES: Readonly<Record<PollTier, number | null>> = {
  hot: 5,
  open: 9,
  routine: 24 * 60,
  closed: 24 * 60,
  retired: null,
};

function daysApart(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today's date in New York (the Court's dates are Eastern). */
export function easternDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Weekday in New York (0 = Sunday). */
export function easternWeekday(now: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * Emergency-docket feeds a user can follow. `targetKey` is stored in
 * entity_follow.target_key (kind 'emergency'). Serious applications only;
 * extensions of time are never sent.
 */
export interface EmergencyFeed { slug: string; label: string; description: string }

export const EMERGENCY_FEEDS: readonly EmergencyFeed[] = [
  { slug: "all", label: "All serious emergency applications", description: "Every application except routine requests for more time to file." },
  { slug: "federal", label: "Federal government applications", description: "Applications filed by the United States, a federal agency or a federal official." },
  { slug: "state", label: "State and local government applications", description: "Applications filed by a state, a city or county, or one of their officials." },
  { slug: "capital", label: "Capital cases (stays of execution)", description: "Applications in death-penalty cases." },
  { slug: "stays", label: "Stays and injunctions (non-capital)", description: "Requests to pause or block a lower court's order, outside capital cases." },
  ...ALLOTMENT.filter((row, index, all) => all.findIndex((other) => other.justiceSlug === row.justiceSlug) === index).map((row) => ({
    slug: `justice:${row.justiceSlug}`,
    label: `Applications to ${row.title === "Chief Justice" ? "the Chief Justice" : `Justice ${row.justiceName.replace(/,?\s+Jr\.$/, "").split(/\s+/).at(-1)}`}`,
    description: `Serious applications submitted to ${row.justiceName} as circuit justice.`,
  })),
];

export function emergencyFeedBySlug(slug: unknown): EmergencyFeed | null {
  return typeof slug === "string" ? EMERGENCY_FEEDS.find((feed) => feed.slug === slug) ?? null : null;
}

/**
 * SQL condition for a feed slug against a scotus_application alias. Built from
 * the fixed catalog above (never from user text), so it is safe to inline.
 */
export function emergencyFeedConditionSql(alias = "a"): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  const justiceCases = EMERGENCY_FEEDS.filter((feed) => feed.slug.startsWith("justice:")).map((feed) => {
    const slug = feed.slug.slice("justice:".length);
    return `(f.target_key = '${feed.slug}' AND ${alias}.submitted_justice_slug = '${slug}')`;
  }).join("\n        OR ");
  return `(${alias}.kind <> 'extension' AND (
        f.target_key = 'all'
        OR (f.target_key = 'federal' AND ${alias}.applicant_kind = 'federal')
        OR (f.target_key = 'state' AND ${alias}.applicant_kind = 'state')
        OR (f.target_key = 'capital' AND (${alias}.capital OR ${alias}.kind = 'stay_of_execution'))
        OR (f.target_key = 'stays' AND ${alias}.kind IN ('stay', 'injunction', 'vacate_stay') AND NOT ${alias}.capital)
        ${justiceCases ? `OR ${justiceCases}` : ""}
      ))`;
}

/** Customer copy about speed. Never "instant" or "real time". */
export const EMERGENCY_TIMING_NOTE = "Jurvio checks open emergency applications on the Court's public docket about every 10 minutes. Alerts usually arrive within 10 to 20 minutes after the Court posts an update. A filing becomes public only when the Court's Clerk dockets it, which can take days for routine requests.";
