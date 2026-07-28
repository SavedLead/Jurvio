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
    separateOpinions: Array<{ author: string; type: "concurrence" | "dissent" | "concurrence_and_dissent" }>;
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
    const candidate = text.slice(syllabusStart.index + syllabusStart[0].length, heldMarker);
    background = bounded(candidate, 2_000) || null;
  }
  const exactHolding = held ? bounded(held, 6_000) : null;
  const significance = exactHolding ? firstSentence(exactHolding) : null;
  const dispositionMatch = /(?:The petition for (?:a writ of )?certiorari is granted[^\n]*|Certiorari granted;[^\n]*|The judgment[^\n]*(?:affirmed|reversed|vacated|remanded)[^\n]*\.)/i.exec(text);
  const exactDisposition = dispositionMatch ? clean(dispositionMatch[0]) : null;
  const authorMatch = /JUSTICE\s+([A-Z][A-Z'’-]+)(?:,?\s+(?:C\.\s*J\.|J\.))?[,]?\s+delivered the opinion of the Court/i.exec(text);
  const author = perCuriam ? null : authorMatch?.[1]?.replaceAll(/\s+/g, " ") ?? null;
  const joins = new Set<string>();
  for (const match of text.matchAll(/(?:in which|joined by)\s+((?:THE CHIEF JUSTICE|JUSTICE\s+[A-Z][A-Z'’-]+)(?:,\s*(?:THE CHIEF JUSTICE|JUSTICE\s+[A-Z][A-Z'’-]+))*(?:,?\s+and\s+(?:THE CHIEF JUSTICE|JUSTICE\s+[A-Z][A-Z'’-]+))?)/gi)) {
    for (const name of (match[1] ?? "").matchAll(/THE CHIEF JUSTICE|JUSTICE\s+([A-Z][A-Z'’-]+)/gi)) joins.add(clean(name[1] ?? "Chief Justice"));
  }
  const separateOpinions: OfficialOpinionMetadata["lineup"]["separateOpinions"] = [];
  for (const match of text.matchAll(/JUSTICE\s+([A-Z][A-Z'’-]+)[^\n]{0,100}\b(concurring in part and dissenting in part|concurring|dissenting)\b/gi)) {
    const label = (match[2] ?? "").toLowerCase();
    const type = label.includes("concurring in part") ? "concurrence_and_dissent" : label === "concurring" ? "concurrence" : "dissent";
    const record = { author: clean(match[1] ?? ""), type } as const;
    if (record.author && !separateOpinions.some((item) => item.author === record.author && item.type === record.type)) separateOpinions.push(record);
  }
  return { perCuriam, background, exactHolding, significance, exactDisposition, syllabus,
    lineup: { author, joins: [...joins], separateOpinions } };
}
