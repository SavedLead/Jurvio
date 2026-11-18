/**
 * Topics for emergency applications, read from the caption, the request
 * type, and the public docket lines. A follow of one of these slugs is a
 * paid topic follow. Charging stays off until billing is turned on.
 */

export interface EmergencyTopic {
  slug: string;
  label: string;
  description: string;
  pattern: RegExp;
}

export const EMERGENCY_TOPICS: readonly EmergencyTopic[] = [
  { slug: "elections", label: "Elections", description: "Ballots, maps, and who can appear on them.", pattern: /\b(election|elections|ballot|redistrict|gerrymander|congressional map)\b/i },
  { slug: "voting", label: "Voting", description: "Who can vote and how a vote is cast or counted.", pattern: /\b(voting|voter|vote by mail|polling place|voter identification)\b/i },
  { slug: "immigration", label: "Immigration", description: "Entry, asylum, removal, and immigration status.", pattern: /\b(immigration|asylum|deport|removal|migrant|border|temporary protected status|\btps\b|visa)\b/i },
  { slug: "executive-power", label: "Executive power", description: "What the President or a federal agency may do.", pattern: /\b(executive order|executive power|presidential|commander in chief|appointment and removal)\b/i },
  { slug: "federal-workforce", label: "Federal workforce", description: "Federal employees, civil service, and agency staff.", pattern: /\b(federal employee|civil service|schedule f|office of personnel|furlough|federal workforce)\b/i },
  { slug: "death-penalty", label: "Death penalty", description: "Executions and stays of execution.", pattern: /\b(death penalty|execution|capital case|lethal injection|stay of execution)\b/i },
  { slug: "religion", label: "Religion", description: "Worship, religious schools, and the religion clauses.", pattern: /\b(religion|religious|church|synagogue|mosque|free exercise|establishment clause)\b/i },
  { slug: "speech", label: "Speech", description: "Speech, protest, and publishing.", pattern: /\b(free speech|censorship|protest|social media ban|compelled speech)\b/i },
  { slug: "campaign-finance", label: "Campaign finance", description: "Campaign money, committees, and contribution limits.", pattern: /\b(campaign finance|political committee|super pac|contribution limit|federal election commission|\bfec\b)\b/i },
];

const BY_SLUG = new Map(EMERGENCY_TOPICS.map((topic) => [topic.slug, topic]));

export function emergencyTopicBySlug(slug: unknown): EmergencyTopic | null {
  return typeof slug === "string" ? BY_SLUG.get(slug) ?? null : null;
}

export function classifyEmergencyTopics(text: string, options: { capital?: boolean; kind?: string } = {}): EmergencyTopic[] {
  const found = EMERGENCY_TOPICS.filter((topic) => topic.pattern.test(text));
  const capital = options.capital || options.kind === "stay_of_execution";
  if (capital && !found.some((topic) => topic.slug === "death-penalty")) {
    const death = BY_SLUG.get("death-penalty");
    if (death) found.push(death);
  }
  return found;
}

const EMERGENCY_DOCKET = /\b(\d{2}A\d{1,4})\b/g;

/** Other emergency docket numbers named in the public text, excluding this case. */
export function relatedEmergencyDockets(self: string, texts: readonly string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(EMERGENCY_DOCKET)) {
      const docket = match[1];
      if (docket && docket !== self) found.add(docket);
    }
  }
  return [...found].slice(0, 8);
}

/** Safe SQL: a topic follow whose slug is one of these and is stored on the application. */
export function emergencyTopicMatchSql(keyExpr: string, topicsExpr: string): string {
  if (keyExpr !== "f.target_key" || topicsExpr !== "d.topics") throw new Error("unexpected topic sql");
  const slugs = EMERGENCY_TOPICS.map((topic) => `'${topic.slug}'`).join(", ");
  return `(f.target_key IN (${slugs}) AND f.target_key = ANY(d.topics))`;
}
