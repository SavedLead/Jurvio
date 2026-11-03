// Topics that can be followed: groups of the federal civil cover sheet's
// "nature of suit" (NOS) codes, which Jurvio already stores on cases
// (legal_case.nature_of_suit_code, e.g. "442 Civil Rights: Employment" or
// just "442"; appeals records sometimes prefix a jurisdiction digit, as in
// "3440 Other Civil Rights" or "2463 Habeas Corpus", which counts as 440 and
// 463). A case matches a topic when its NOS code number falls in one
// of the topic's ranges, or, for a code stored as text only, when the text
// matches the topic's label pattern. Change the catalog here; follows store
// only the slug.
//
// Only public case metadata is used: NOS comes from the case's own filing
// record, never from docket text.

export interface TopicDefinition {
  slug: string;
  label: string;
  description: string;
  /** Inclusive NOS code ranges. */
  ranges: ReadonlyArray<readonly [number, number]>;
  /** Case-insensitive POSIX regex for NOS values stored without a number. */
  textPattern: string;
  /** Optional regex that vetoes a text-only match (e.g. "Prisoner: Civil Rights" is not a civil rights suit). */
  excludePattern?: string;
}

export const TOPICS: readonly TopicDefinition[] = [
  { slug: "civil-rights", label: "Civil rights", description: "Voting, employment, housing, disability and other civil rights suits.",
    ranges: [[440, 448]], textPattern: "civil rights", excludePattern: "prisoner" },
  { slug: "prisoner-petitions", label: "Prisoner petitions", description: "Habeas corpus, motions to vacate sentence and prison-condition suits.",
    ranges: [[510, 560]], textPattern: "habeas|prisoner|prison condition|vacate sentence" },
  { slug: "employment-labor", label: "Employment and labor", description: "Fair Labor Standards Act, ERISA, labor relations and family leave.",
    ranges: [[710, 799]], textPattern: "labor|erisa|fair labor|family and medical leave" },
  { slug: "contracts", label: "Contracts", description: "Contract disputes, insurance, negotiable instruments and franchise.",
    ranges: [[110, 196]], textPattern: "contract|insurance|negotiable instrument|franchise" },
  { slug: "personal-injury", label: "Personal injury and torts", description: "Product liability, medical malpractice, motor vehicle, asbestos and property damage.",
    ranges: [[310, 371], [380, 385]], textPattern: "personal injury|p.i.:|product liability|malpractice|motor vehicle|asbestos|assault|libel|slander|property damage|fraud|truth in lending" },
  { slug: "intellectual-property", label: "Intellectual property", description: "Copyright, patent, trademark and trade secrets.",
    ranges: [[820, 840], [880, 880]], textPattern: "copyright|patent|trademark|trade secret" },
  { slug: "securities", label: "Securities and commodities", description: "Securities, commodities and exchange suits.",
    ranges: [[850, 850]], textPattern: "securities|commodities" },
  { slug: "consumer", label: "Consumer credit and protection", description: "Consumer credit, debt collection and telephone consumer protection.",
    ranges: [[480, 485]], textPattern: "consumer credit|telephone consumer" },
  { slug: "antitrust", label: "Antitrust", description: "Competition and antitrust suits.",
    ranges: [[410, 410]], textPattern: "antitrust" },
  { slug: "immigration", label: "Immigration", description: "Naturalization, other immigration actions and deportation.",
    ranges: [[460, 465]], textPattern: "immigration|naturalization|deportation" },
  { slug: "social-security", label: "Social Security", description: "Disability (DIWC/DIWW), SSID, RSI and black lung appeals.",
    ranges: [[861, 865]], textPattern: "social security|ssid|diwc|diww|black lung" },
  { slug: "real-property", label: "Real property", description: "Foreclosure, land condemnation, rent, lease and ejectment.",
    ranges: [[210, 290]], textPattern: "real property|foreclosure|condemnation|ejectment|rent lease" },
  { slug: "tax", label: "Federal tax", description: "Tax suits by or against the United States.",
    ranges: [[870, 871]], textPattern: "tax suit" },
  { slug: "bankruptcy", label: "Bankruptcy appeals", description: "Appeals and withdrawals of reference from bankruptcy court.",
    ranges: [[422, 423]], textPattern: "bankruptcy" },
  { slug: "environment", label: "Environment", description: "Environmental matters.",
    ranges: [[893, 893]], textPattern: "environmental" },
  { slug: "government-records", label: "FOIA and government records", description: "Freedom of Information Act and administrative procedure suits.",
    ranges: [[895, 895], [899, 899]], textPattern: "freedom of information|administrative procedure" },
  { slug: "false-claims-fraud", label: "False Claims Act and RICO", description: "Qui tam / False Claims Act and racketeering (RICO) suits.",
    ranges: [[375, 376], [470, 470]], textPattern: "false claims|qui tam|racketeer" },
  { slug: "constitutional", label: "Constitutionality of state statutes", description: "Challenges to the constitutionality of state statutes.",
    ranges: [[950, 950]], textPattern: "constitutionality" },
];

const BY_SLUG = new Map(TOPICS.map((topic) => [topic.slug, topic]));

export function topicBySlug(slug: unknown): TopicDefinition | null {
  return typeof slug === "string" ? BY_SLUG.get(slug) ?? null : null;
}

/** Leading NOS number of a stored code ("442 Civil Rights: Employment" -> 442, "3440 Other Civil Rights" -> 440). */
export function nosNumber(code: string | null | undefined): number | null {
  const match = /^\s*\d?(\d{3})(?!\d)/.exec(code ?? "");
  return match ? Number(match[1]) : null;
}

/** In-memory version of topicMatchSql (tests, the case page). */
export function caseMatchesTopic(topic: TopicDefinition, code: string | null | undefined): boolean {
  if (!code?.trim()) return false;
  const number = nosNumber(code);
  if (number !== null) return topic.ranges.some(([lo, hi]) => number >= lo && number <= hi);
  return new RegExp(topic.textPattern, "i").test(code) && !(topic.excludePattern && new RegExp(topic.excludePattern, "i").test(code));
}

/** Topics a case's NOS code belongs to (normally zero or one). */
export function topicsForNos(code: string | null | undefined): TopicDefinition[] {
  return TOPICS.filter((topic) => caseMatchesTopic(topic, code));
}

const SAFE_PATTERN = /^[a-z0-9 |()/.:-]+$/;

/**
 * SQL condition: `codeExpr` (a nature_of_suit_code column) belongs to `topic`.
 * Values come from the catalog above, never from a request.
 */
export function topicMatchSql(topic: TopicDefinition, codeExpr: string): string {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(codeExpr)) throw new Error("invalid column");
  if (!SAFE_PATTERN.test(topic.textPattern)) throw new Error("invalid topic pattern");
  if (topic.excludePattern !== undefined && !SAFE_PATTERN.test(topic.excludePattern)) throw new Error("invalid topic pattern");
  const number = `substring(${codeExpr} from '^\\s*[0-9]?([0-9]{3})([^0-9]|$)')`;
  const ranges = topic.ranges.map(([lo, hi]) => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error("invalid range");
    return `(${number})::int BETWEEN ${lo} AND ${hi}`;
  }).join(" OR ");
  return `(${codeExpr} IS NOT NULL AND CASE WHEN ${number} IS NOT NULL THEN (${ranges}) ELSE ${codeExpr} ~* '${topic.textPattern}'${topic.excludePattern ? ` AND ${codeExpr} !~* '${topic.excludePattern}'` : ""} END)`;
}
