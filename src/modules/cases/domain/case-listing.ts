// Pure helpers for the public /cases listing: URL parameter parsing, link
// building, active-filter chips, latest-event selection, and search-term
// highlighting. Everything here is deterministic and free of I/O.

export type CaseListingSort = "best" | "recent" | "oldest" | "az";
export type CaseListingDensity = "comfortable" | "compact";

export interface CaseListingFilters {
  page: number;
  query: string | null;
  court: string | null;
  party: string | null;
  firm: string | null;
  decided: boolean;
  opinion: boolean;
  verified: boolean;
  fromYear: number | null;
  toYear: number | null;
  sort: CaseListingSort;
  density: CaseListingDensity;
  /** Opaque newest-first cursor. Absent on the first page. */
  before: string | null;
}

export type CaseListingParams = Partial<Record<
  "page" | "q" | "court" | "party" | "firm" | "decided" | "opinion" | "verified" | "from" | "to" | "sort" | "view" | "before",
  string | string[]
>>;

export interface CaseListCursor {
  on: string | null;
  caption: string;
  id: string;
}

export function encodeCaseCursor(cursor: CaseListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCaseCursor(value: string | null | undefined): CaseListCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CaseListCursor>;
    if (typeof parsed.caption !== "string" || typeof parsed.id !== "string") return null;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.id)) return null;
    if (parsed.on !== null && (typeof parsed.on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.on))) return null;
    return { on: parsed.on ?? null, caption: parsed.caption, id: parsed.id };
  } catch {
    return null;
  }
}

const MIN_YEAR = 1789;
const MAX_TEXT = 200;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cursorParam(value: string | string[] | undefined) {
  const raw = first(value)?.trim();
  if (!raw || raw.length > 2000 || !decodeCaseCursor(raw)) return null;
  return raw;
}

function text(value: string | string[] | undefined) {
  const cleaned = first(value)?.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  return cleaned ? cleaned : null;
}

function flag(value: string | string[] | undefined) {
  return first(value) === "1";
}

function year(value: string | string[] | undefined, maxYear: number) {
  const raw = first(value)?.trim();
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= MIN_YEAR && parsed <= maxYear ? parsed : null;
}

export function parseCaseListingParams(raw: CaseListingParams, now = new Date()): CaseListingFilters {
  const maxYear = now.getUTCFullYear() + 1;
  const query = text(raw.q);
  let fromYear = year(raw.from, maxYear);
  let toYear = year(raw.to, maxYear);
  if (fromYear !== null && toYear !== null && fromYear > toYear) [fromYear, toYear] = [toYear, fromYear];

  const requestedSort = first(raw.sort);
  const sort: CaseListingSort = requestedSort === "recent" || requestedSort === "oldest" || requestedSort === "az"
    ? requestedSort
    : requestedSort === "best" && query ? "best"
      : query ? "best" : "recent";

  return {
    page: Math.min(Math.max(Number.parseInt(first(raw.page) ?? "1", 10) || 1, 1), 1000),
    query,
    court: text(raw.court),
    party: text(raw.party),
    firm: text(raw.firm),
    decided: flag(raw.decided),
    opinion: flag(raw.opinion),
    verified: flag(raw.verified),
    fromYear,
    toYear,
    sort,
    density: first(raw.view) === "compact" ? "compact" : "comfortable",
    before: cursorParam(raw.before),
  };
}

/** The sort used when no explicit sort is requested. */
export function defaultSort(filters: Pick<CaseListingFilters, "query">): CaseListingSort {
  return filters.query ? "best" : "recent";
}

/** True when the listing contains user-entered text, which must not be cached in shared snapshots. */
export function hasUserText(filters: CaseListingFilters) {
  return Boolean(filters.query || filters.party || filters.firm);
}

export function hasActiveFilters(filters: CaseListingFilters) {
  return Boolean(
    filters.query || filters.court || filters.party || filters.firm || filters.decided || filters.opinion
      || filters.verified || filters.fromYear || filters.toYear,
  );
}

export function buildCaseListingHref(filters: CaseListingFilters, overrides: Partial<CaseListingFilters> = {}) {
  const next = { ...filters, ...overrides };
  if (!Object.prototype.hasOwnProperty.call(overrides, "before")) next.before = null;
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.court) params.set("court", next.court);
  if (next.party) params.set("party", next.party);
  if (next.firm) params.set("firm", next.firm);
  if (next.decided) params.set("decided", "1");
  if (next.opinion) params.set("opinion", "1");
  if (next.verified) params.set("verified", "1");
  if (next.fromYear) params.set("from", String(next.fromYear));
  if (next.toYear) params.set("to", String(next.toYear));
  if (next.sort !== defaultSort(next) && !(next.sort === "best" && !next.query)) params.set("sort", next.sort);
  if (next.density === "compact") params.set("view", "compact");
  if (next.before) params.set("before", next.before);
  if (next.page > 1) params.set("page", String(next.page));
  const search = params.toString();
  return search ? `/cases?${search}` : "/cases";
}

export interface CaseListingChip {
  label: string;
  href: string;
}

export function activeFilterChips(filters: CaseListingFilters, courtLabel: string | null): CaseListingChip[] {
  const base = { ...filters, page: 1 };
  const chips: CaseListingChip[] = [];
  if (filters.query) chips.push({ label: `“${filters.query}”`, href: buildCaseListingHref(base, { query: null, sort: base.sort === "best" ? "recent" : base.sort }) });
  if (filters.court) chips.push({ label: courtLabel ?? filters.court, href: buildCaseListingHref(base, { court: null }) });
  if (filters.party) chips.push({ label: `Party: ${filters.party}`, href: buildCaseListingHref(base, { party: null }) });
  if (filters.firm) chips.push({ label: `Law firm: ${filters.firm}`, href: buildCaseListingHref(base, { firm: null }) });
  if (filters.decided) chips.push({ label: "Decision issued", href: buildCaseListingHref(base, { decided: false }) });
  if (filters.opinion) chips.push({ label: "Readable opinion", href: buildCaseListingHref(base, { opinion: false }) });
  if (filters.verified) chips.push({ label: "Status verified", href: buildCaseListingHref(base, { verified: false }) });
  if (filters.fromYear || filters.toYear) {
    const label = filters.fromYear && filters.toYear
      ? filters.fromYear === filters.toYear ? `${filters.fromYear}` : `${filters.fromYear}–${filters.toYear}`
      : filters.fromYear ? `${filters.fromYear} or later` : `${filters.toYear} or earlier`;
    chips.push({ label, href: buildCaseListingHref(base, { fromYear: null, toYear: null }) });
  }
  return chips;
}

export interface LatestCaseEvent {
  date: string;
  label: string;
}

/**
 * Mirrors the case page's "latest update": the most recent of the filing date,
 * the latest dated public docket entry, and the decision date. On equal dates a
 * decision outranks a docket entry, which outranks the filing.
 */
export function pickLatestCaseEvent(input: {
  filedOn: string | null;
  decidedOn: string | null;
  latestEntryOn: string | null;
  latestEntryDescription: string | null;
}): LatestCaseEvent | null {
  const candidates: LatestCaseEvent[] = [];
  if (input.filedOn) candidates.push({ date: input.filedOn, label: "Case filed" });
  if (input.latestEntryOn && input.latestEntryDescription?.trim()) {
    candidates.push({ date: input.latestEntryOn, label: input.latestEntryDescription.replace(/\s+/g, " ").trim() });
  }
  if (input.decidedOn) candidates.push({ date: input.decidedOn, label: "Decision issued" });
  return candidates.reduce<LatestCaseEvent | null>((latest, event) => (!latest || event.date >= latest.date ? event : latest), null);
}

export function truncateLabel(label: string, maxLength = 120) {
  if (label.length <= maxLength) return label;
  const cut = label.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Splits text into plain and matching segments for a case-insensitive literal query. */
export function highlightSegments(value: string, query: string | null | undefined): HighlightSegment[] {
  const needle = query?.trim().toLowerCase();
  if (!needle || needle.length < 2) return [{ text: value, match: false }];
  const haystack = value.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) segments.push({ text: value.slice(cursor, index), match: false });
    segments.push({ text: value.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), match: false });
  return segments.length ? segments : [{ text: value, match: false }];
}

function normalizeIdentifier(value: string) {
  return value.toLowerCase().replace(/^no\.\s*/, "").replace(/\s+/g, " ").trim();
}

export type ExactMatchKind = "docket" | "citation";

/** Detects a query that names one case exactly by docket number or official citation. */
export function exactMatchKind(
  query: string | null,
  legalCase: { docketNumber: string; officialCitation: string | null },
): ExactMatchKind | null {
  if (!query) return null;
  const needle = normalizeIdentifier(query);
  if (needle.length < 4) return null;
  if (normalizeIdentifier(legalCase.docketNumber) === needle) return "docket";
  const citation = legalCase.officialCitation ? normalizeIdentifier(legalCase.officialCitation) : null;
  if (citation && (citation === needle || citation.replace(/\s*\(\d{4}\)$/, "") === needle)) return "citation";
  return null;
}

const AUTHOR_TITLE_SUFFIX = /,?\s*(?:c\.\s*j\.|j\.|jj\.|chief\s+justice|justice|chief\s+judge|judge)\s*$/i;
const AUTHOR_TITLE_PREFIX = /^(?:hon(?:orable)?\.?|chief\s+justice|justice|chief\s+judge|judge)\s+/i;

function surnameOf(name: string) {
  const words = name
    .replace(AUTHOR_TITLE_PREFIX, "")
    .replace(AUTHOR_TITLE_SUFFIX, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !/^(?:jr|sr|ii|iii|iv)$/.test(word));
  return words.at(-1) ?? null;
}

/**
 * Picks the judge profile to link an opinion author's name to. Only verified
 * public judges already assigned to the case as an opinion author are
 * candidates, and the link is made only when exactly one shares the author's
 * surname, so an ambiguous name stays plain text.
 */
export function matchOpinionAuthorJudge<T extends { normalizedName: string }>(
  authorName: string | null,
  candidates: T[],
): T | null {
  if (!authorName) return null;
  const surname = surnameOf(authorName);
  if (!surname) return null;
  const matches = candidates.filter((candidate) => surnameOf(candidate.normalizedName) === surname);
  return matches.length === 1 ? matches[0]! : null;
}
