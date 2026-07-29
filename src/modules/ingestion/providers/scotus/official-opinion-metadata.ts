export type JusticePosition =
  | "court_opinion"
  | "concurrence"
  | "concurrence_in_judgment"
  | "dissent"
  | "concurrence_and_dissent"
  | "not_participating";

export interface OfficialOpinionMetadata {
  perCuriam: boolean;
  background: string | null;
  exactHolding: string | null;
  significance: string | null;
  exactDisposition: string | null;
  syllabus: string | null;
  lineup: {
    author: string | null;
    joins: string[];
    separateOpinions: Array<{
      author: string;
      type: "concurrence" | "concurrence_in_judgment" | "dissent" | "concurrence_and_dissent";
      joins: string[];
    }>;
    recusals: string[];
    justiceVotes: Array<{ justice: string; position: JusticePosition }>;
    voteBreakdown: {
      forJudgment: number;
      courtOpinion: number;
      concurring: number;
      dissenting: number;
      mixed: number;
      notParticipating: number;
      label: string | null;
    };
  };
}

function clean(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}

function bounded(value: string, maximum = 4_000) {
  const normalized = clean(value);
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum).replace(/\s+\S*$/, "")}…`;
}

function firstSentence(value: string) {
  const normalized = clean(value);
  const match = /^(.+?[.!?])(?:\s|$)/.exec(normalized);
  return match?.[1] ?? (normalized || null);
}

function justiceName(value: string) {
  return clean(value).replace(/^JUSTICE\s+/i, "").replaceAll(/[.,]/g, "").toUpperCase();
}

const nonNames = new Set([
  "A", "AN", "AND", "C", "CHIEF", "COURT", "DELIVERED", "FILED", "IN", "J", "JJ",
  "JOINED", "JUSTICE", "OF", "OPINION", "PART", "THE", "WHICH",
]);

function justiceNames(value: string) {
  const names: string[] = [];
  const add = (name: string) => {
    const normalized = justiceName(name);
    if (normalized && !nonNames.has(normalized) && !names.includes(normalized)) names.push(normalized);
  };
  for (const match of value.matchAll(/JUSTICE\s+([A-Z][A-Z'’\-]+)/gi)) add(match[1] ?? "");
  const withoutTitles = value.replaceAll(/JUSTICE\s+/gi, "");
  for (const match of withoutTitles.matchAll(/\b([A-Z][A-Z'’\-]{1,})\b/g)) add(match[1] ?? "");
  return names;
}

function positionType(value: string): Exclude<JusticePosition, "court_opinion" | "not_participating"> {
  const label = value.toLowerCase();
  if (label.includes("concurring in part") && label.includes("dissenting in part")) return "concurrence_and_dissent";
  if (label.includes("concurring in the judgment") || label.includes("concurring in judgment")) return "concurrence_in_judgment";
  if (label.includes("dissent")) return "dissent";
  return "concurrence";
}

export function extractOfficialOpinionMetadata(sourceText: string): OfficialOpinionMetadata {
  const text = sourceText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const perCuriam = /(^|\n)\s*(?:PER CURIAM|Per Curiam)\s*(?:\n|$)/m.test(text);
  const held = /(?:^|\n)\s*Held:\s*([\s\S]*?)(?=\n\s*(?:Pp?\.\s*\d|Certiorari granted|Affirmed|Reversed|Vacated|PER CURIAM|Per Curiam)\b)/im.exec(text)?.[1] ?? null;
  const syllabusStart = /(?:^|\n)\s*(?:Syllabus|NOTICE:[\s\S]{0,800}?syllabus[^\n]*\n)/im.exec(text);
  const syllabusEnd = held ? text.indexOf(held) + held.length : -1;
  const syllabus = syllabusStart && syllabusEnd > syllabusStart.index
    ? bounded(text.slice(syllabusStart.index, syllabusEnd), 12_000) : null;
  let background: string | null = null;
  if (syllabusStart && held) {
    const heldMarker = text.lastIndexOf("Held:", text.indexOf(held));
    background = bounded(text.slice(syllabusStart.index + syllabusStart[0].length, heldMarker), 2_000) || null;
  }
  const exactHolding = held ? bounded(held, 6_000) : null;
  const significance = exactHolding ? firstSentence(exactHolding) : null;
  const dispositionMatch = /(?:The petition for (?:a writ of )?certiorari is granted[^\n]*|Certiorari granted;[^\n]*|The judgment[^\n]*(?:affirmed|reversed|vacated|remanded)[^\n]*\.)/i.exec(text);
  const exactDisposition = dispositionMatch ? clean(dispositionMatch[0]) : null;

  const authorMatch = perCuriam ? null
    : /(?:JUSTICE\s+)?([A-Z][A-Z'’\-]+),?\s*(?:C\.\s*J\.|J\.)?[,]?\s+delivered the opinion of the Court/i.exec(text);
  const author = authorMatch?.[1] ? justiceName(authorMatch[1]) : null;
  const joins = new Set<string>();
  const courtOpinionSentence = /delivered the opinion of the Court([^\n]{0,700})/i.exec(text)?.[1] ?? "";
  const courtJoins = /in which\s+([\s\S]*?)\s+joined/i.exec(courtOpinionSentence)?.[1] ?? "";
  for (const name of justiceNames(courtJoins)) if (name !== author) joins.add(name);

  const separateOpinions: OfficialOpinionMetadata["lineup"]["separateOpinions"] = [];
  const separatePattern = /(?:JUSTICE\s+)?([A-Z][A-Z'’\-]+),?\s*(?:C\.\s*J\.|J\.)?[,]?\s+(?:filed|delivered)\s+(?:an?\s+)?opinion\s+([^\n]{0,300})(?:\n|$)/gi;
  for (const match of text.matchAll(separatePattern)) {
    const description = clean(match[2] ?? "");
    if (!/concurr|dissent/i.test(description)) continue;
    const joinFragment = /in which\s+([\s\S]*?)\s+joined/i.exec(description)?.[1] ?? "";
    const record = {
      author: justiceName(match[1] ?? ""),
      type: positionType(description),
      joins: justiceNames(joinFragment),
    };
    if (record.author && !separateOpinions.some((item) => item.author === record.author && item.type === record.type)) separateOpinions.push(record);
  }
  for (const match of text.matchAll(/JUSTICE\s+([A-Z][A-Z'’\-]+)[^\n]{0,100}\b(concurring in part and dissenting in part|concurring in the judgment|concurring|dissenting)\b/gi)) {
    const record = { author: justiceName(match[1] ?? ""), type: positionType(match[2] ?? ""), joins: [] };
    if (record.author && record.author !== author && !separateOpinions.some((item) => item.author === record.author && item.type === record.type)) separateOpinions.push(record);
  }

  const recusals = new Set<string>();
  for (const match of text.matchAll(/(?:JUSTICE\s+)?([A-Z][A-Z'’\-]+),?\s*(?:C\.\s*J\.|J\.)?[,]?\s+took no part/gi)) {
    if (match[1]) recusals.add(justiceName(match[1]));
  }

  const votes = new Map<string, JusticePosition>();
  if (author) votes.set(author, "court_opinion");
  for (const name of joins) votes.set(name, "court_opinion");
  for (const opinion of separateOpinions) {
    votes.set(opinion.author, opinion.type);
    for (const name of opinion.joins) votes.set(name, opinion.type);
  }
  for (const name of recusals) votes.set(name, "not_participating");
  const justiceVotes = [...votes].map(([justice, position]) => ({ justice, position }))
    .sort((left, right) => left.justice.localeCompare(right.justice));
  const courtOpinion = justiceVotes.filter((vote) => vote.position === "court_opinion").length;
  const concurring = justiceVotes.filter((vote) => vote.position === "concurrence" || vote.position === "concurrence_in_judgment").length;
  const dissenting = justiceVotes.filter((vote) => vote.position === "dissent").length;
  const mixed = justiceVotes.filter((vote) => vote.position === "concurrence_and_dissent").length;
  const notParticipating = justiceVotes.filter((vote) => vote.position === "not_participating").length;
  const forJudgment = courtOpinion + concurring;
  const label = forJudgment > 0 && dissenting > 0 && mixed === 0 ? `${forJudgment}–${dissenting}` : null;

  return {
    perCuriam, background, exactHolding, significance, exactDisposition, syllabus,
    lineup: {
      author,
      joins: [...joins],
      separateOpinions,
      recusals: [...recusals],
      justiceVotes,
      voteBreakdown: { forJudgment, courtOpinion, concurring, dissenting, mixed, notParticipating, label },
    },
  };
}
