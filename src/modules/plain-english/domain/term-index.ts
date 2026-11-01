import { legalExplainers } from "@/modules/explainers/domain/explainers";
import { glossaryTerms, type GlossaryTerm } from "@/modules/explainers/domain/glossary";
import { glossaryAdditions } from "@/modules/explainers/domain/glossary-additions";
import { termKey } from "./term-key";

/**
 * Hover/tap definitions for legal terms on public pages.
 *
 * The index is built once per server process from the static Legal Dictionary
 * (glossary + deep explainers), so marking terms never queries the database.
 * Matching is longest-label-first, whole-word only, and callers mark only the
 * first occurrence of each term per section (see createTermMarker).
 */
export interface PlainTerm {
  /** Stable key, also the dictionary anchor: /explainers#term-<key>. */
  key: string;
  term: string;
  definition: string;
  /** "Learn more" target: the deep explainer if one exists, else the dictionary entry. */
  href: string;
}

/**
 * Dictionary terms that are ordinary English (or too ambiguous) to underline in
 * running text. They stay in the Dictionary; they are just not marked inline.
 */
const NOT_MARKED = new Set([
  "lawsuit", "plaintiff", "defendant", "complaint", "claim", "docket", "hearing", "motion", "order",
  "judgment", "appeal", "settlement", "trial", "evidence", "answer", "allegation", "discovery",
  "privilege", "declaration", "exhibit", "testimony", "witness", "expert witness", "objection",
  "jury", "verdict", "liability", "damages", "default", "counsel", "supreme court", "district court",
  "circuit court", "removal", "case number", "caption", "stay", "ripe", "standing", "citation",
  "brief", "mandate", "oral argument", "opinion of the court", "state trial court",
  "intermediate appellate court", "state supreme court", "information", "bail", "sentencing",
  "probation", "parole", "discharge", "patent", "trademark", "copyright", "treaty", "asylum",
  "executor", "discrimination", "retaliation", "tribal court", "search warrant",
  "wrongful termination", "child custody", "divorce decree", "foreclosure",
]);

/** Glossary aliases that are too generic to match on their own. */
const NOT_MARKED_ALIASES = new Set([
  "service", "forum", "cert", "bond", "reorganization", "exhaustion", "protective order",
  "jury trial", "bench trial", "appellate review", "docket number", "personal representative",
  "judgment of divorce", "beyond authority", "beyond legal power", "settlement agreement", "consent judgment", "rule 56", "rule 12 motion", "proper venue",
  "remand order", "affirming", "reversing", "vacating",
]);

/** Inflections and common phrasings that should resolve to a dictionary term. */
const EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  affirmed: ["affirm", "affirms", "affirmance"],
  reversed: ["reverses", "reversal"],
  vacated: ["vacate", "vacates", "vacatur"],
  remand: ["remanded", "remands", "remanding"],
  "dismissed with prejudice": ["with prejudice"],
  "dismissed without prejudice": ["without prejudice"],
  "cert granted": ["certiorari granted", "cert. granted"],
  "cert denied": ["certiorari denied", "cert. denied"],
  "petition for certiorari": ["petition for a writ of certiorari", "petitions for certiorari"],
  "per curiam": ["per curiam opinion"],
  "habeas corpus": ["habeas", "writ of habeas corpus"],
  mandamus: ["writ of mandamus"],
  "amicus curiae": ["amicus", "amici curiae", "amicus brief"],
  "concurring opinion": ["concurrence", "concurring in the judgment"],
  "dissenting opinion": ["dissent"],
  "majority opinion": [],
  "pro se": ["self-represented"],
  "en banc": ["rehearing en banc"],
  subpoena: ["subpoenas", "subpoenaed"],
  deposition: ["depositions"],
  affidavit: ["affidavits"],
  interrogatories: ["interrogatory"],
  indictment: ["indicted"],
  injunction: ["injunctive relief"],
  moot: ["mootness"],
  tolling: ["tolled"],
  "statute of limitations": ["limitations period"],
  "summary judgment": ["partial summary judgment"],
  "motion to dismiss": ["motions to dismiss"],
  "class action": ["class actions"],
  "temporary restraining order": ["temporary restraining orders"],
};

/** Labels that must match with exact capitalization (acronyms). */
function caseSensitive(label: string) {
  return /^[A-Z][A-Z/]+$/.test(label);
}

export { termKey };

function explainerSlugFor(item: GlossaryTerm, explainerByLabel: Map<string, string>) {
  if (item.explainerSlug) return item.explainerSlug;
  return explainerByLabel.get(item.term.toLowerCase()) ?? null;
}

export interface TermIndex {
  terms: ReadonlyMap<string, PlainTerm>;
  /** Lower-cased match label -> term key. */
  labels: ReadonlyMap<string, string>;
  /** Exact-case labels (acronyms). */
  exactLabels: ReadonlySet<string>;
  /** Lower-case acronym label -> required exact form. */
  exactByLower: ReadonlyMap<string, string>;
  pattern: RegExp;
}

export function buildTermIndex(
  glossary: readonly GlossaryTerm[] = [...glossaryTerms, ...glossaryAdditions],
): TermIndex {
  const explainerByLabel = new Map<string, string>();
  for (const explainer of legalExplainers) {
    explainerByLabel.set(explainer.term.toLowerCase(), explainer.slug);
    for (const alias of explainer.aliases) explainerByLabel.set(alias.toLowerCase(), explainer.slug);
  }
  // A few glossary terms are worded differently from their explainer.
  explainerByLabel.set("dismissed with prejudice", "dismissal-with-or-without-prejudice");
  explainerByLabel.set("dismissed without prejudice", "dismissal-with-or-without-prejudice");

  const terms = new Map<string, PlainTerm>();
  const labels = new Map<string, string>();
  const exactLabels = new Set<string>();
  const addLabel = (label: string, key: string) => {
    const trimmed = label.trim();
    if (trimmed.length < 3) return;
    const lower = trimmed.toLowerCase();
    if (NOT_MARKED_ALIASES.has(lower) || labels.has(lower)) return;
    labels.set(lower, key);
    if (caseSensitive(trimmed)) exactLabels.add(trimmed);
  };

  for (const item of glossary) {
    const lower = item.term.toLowerCase();
    if (NOT_MARKED.has(lower)) continue;
    const key = termKey(item.term);
    if (terms.has(key)) continue;
    const slug = explainerSlugFor(item, explainerByLabel);
    terms.set(key, {
      key,
      term: item.term,
      definition: item.definition,
      href: slug ? `/explainers/${slug}` : `/explainers#term-${key}`,
    });
    addLabel(item.term, key);
    for (const alias of [...(item.aliases ?? []), ...(EXTRA_ALIASES[lower] ?? [])]) addLabel(alias, key);
  }
  // Deep explainers with no glossary twin (e.g. "Petitioner and respondent").
  for (const explainer of legalExplainers) {
    const key = termKey(explainer.term);
    if (terms.has(key) || [...labels.keys()].includes(explainer.term.toLowerCase())) continue;
    if (NOT_MARKED.has(explainer.term.toLowerCase())) continue;
    terms.set(key, { key, term: explainer.term, definition: explainer.oneLine, href: `/explainers/${explainer.slug}` });
    addLabel(explainer.term, key);
    for (const alias of explainer.aliases) addLabel(alias, key);
  }

  const sorted = [...labels.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const alternation = sorted.map(escapeRegExp).join("|");
  // Whole words only; letters, digits and hyphens on either side block a match.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\-])(?:${alternation})(?![\\p{L}\\p{N}\\-])`, "giu");
  const exactByLower = new Map([...exactLabels].map((label) => [label.toLowerCase(), label]));
  return { terms, labels, exactLabels, exactByLower, pattern };
}

function escapeRegExp(value: string) {
  return value.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\s+/g, "\\s+");
}

let cachedIndex: TermIndex | null = null;
/** The process-wide index (built on first use, then reused for every render). */
export function termIndex(): TermIndex {
  cachedIndex ??= buildTermIndex();
  return cachedIndex;
}

export type TermSegment = string | { text: string; term: PlainTerm };

/**
 * Split text into plain strings and dictionary-term matches. `seen` holds term
 * keys already marked in the current section; each term is marked once.
 */
export function segmentTerms(text: string, seen: Set<string>, index: TermIndex = termIndex()): TermSegment[] {
  if (!text) return [];
  const segments: TermSegment[] = [];
  let cursor = 0;
  index.pattern.lastIndex = 0;
  for (const match of text.matchAll(index.pattern)) {
    const label = match[0];
    const start = match.index ?? 0;
    const lower = label.toLowerCase().replace(/\s+/g, " ");
    const key = index.labels.get(lower);
    if (!key || seen.has(key)) continue;
    const exact = index.exactByLower.get(lower);
    if (exact && exact !== label) continue;
    const term = index.terms.get(key);
    if (!term) continue;
    seen.add(key);
    if (start > cursor) segments.push(text.slice(cursor, start));
    segments.push({ text: label, term });
    cursor = start + label.length;
  }
  if (cursor < text.length) segments.push(text.slice(cursor));
  return segments;
}

/** Terms present in a text (any occurrence), for sending only what a page needs to the client. */
export function termsInText(text: string, index: TermIndex = termIndex()): PlainTerm[] {
  const found = new Map<string, PlainTerm>();
  for (const match of text.matchAll(index.pattern)) {
    const lower = match[0].toLowerCase().replace(/\s+/g, " ");
    const key = index.labels.get(lower);
    if (!key || found.has(key)) continue;
    const exact = index.exactByLower.get(lower);
    if (exact && exact !== match[0]) continue;
    const term = index.terms.get(key);
    if (term) found.set(key, term);
  }
  return [...found.values()];
}

/** [lower-case label, key, exact-case acronym?] for a set of terms, for client-side matching. */
export function labelsForTerms(keys: ReadonlySet<string>, index: TermIndex = termIndex()): Array<[string, string, string?]> {
  return [...index.labels.entries()].filter(([, key]) => keys.has(key))
    .map(([label, key]) => {
      const exact = index.exactByLower.get(label);
      return exact ? [label, key, exact] : [label, key];
    });
}
