import type { Metadata, Route } from "next";
import Link from "next/link";
import { viewerHasSubscriberAccess } from "@/modules/accounts/http/viewer";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import {
  listPublicCaseCourts,
  listPublicCases,
  type ListPublicCasesOptions,
  type PublicCaseListItem,
} from "@/modules/cases/application/list-public-cases";
import {
  activeFilterChips,
  buildCaseListingHref,
  decodeCaseCursor,
  encodeCaseCursor,
  exactMatchKind,
  hasActiveFilters,
  hasUserText,
  matchOpinionAuthorJudge,
  parseCaseListingParams,
  pickLatestCaseEvent,
  truncateLabel,
  type CaseListingFilters,
  type CaseListingParams,
  type CaseListingSort,
} from "@/modules/cases/domain/case-listing";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import { BrandedCaseCaption, HighlightedText } from "@/modules/cases/ui/branded-case-caption";
import { CopyCitationButton } from "@/modules/cases/ui/copy-citation-button";
import { FilterDisclosure } from "@/modules/cases/ui/filter-disclosure";
import styles from "./cases.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 300;

const PAGE_SIZE = 50;

const listCachedPublicCases = unstable_cache(
  async (options: ListPublicCasesOptions) => listPublicCases(db(), options),
  ["public-case-directory-v5"],
  { revalidate: 300, tags: ["public-cases"] },
);
const listCachedPublicCaseCourts = unstable_cache(
  async () => listPublicCaseCourts(db()),
  ["public-case-court-facets-v2"],
  { revalidate: 300, tags: ["public-cases"] },
);

export async function generateMetadata({ searchParams }: { searchParams: Promise<CaseListingParams> }): Promise<Metadata> {
  const filters = parseCaseListingParams(await searchParams);
  const variant = hasActiveFilters(filters) || filters.density === "compact" || filters.sort !== (filters.query ? "best" : "recent");
  return {
    title: "Find a court case",
    description: "Search verified, published court cases by case name, party, docket number, citation, or court.",
    alternates: { canonical: "/cases" },
    // Filtered, re-sorted and re-styled views duplicate /cases; keep them out of the index.
    ...(variant ? { robots: { index: false, follow: true } } : {}),
  };
}

const SORT_LABELS: Record<CaseListingSort, string> = {
  best: "Best match",
  recent: "Most recent",
  oldest: "Oldest",
  az: "Case name A–Z",
};

const SORT_DESCRIPTIONS: Record<CaseListingSort, string> = {
  best: "Exact docket and citation matches first, then matching case names, then newest.",
  recent: "Most recent filing or decision first.",
  oldest: "Oldest filing or decision first.",
  az: "Sorted alphabetically by case name.",
};

function toQueryOptions(filters: CaseListingFilters): ListPublicCasesOptions {
  return {
    page: filters.page,
    pageSize: PAGE_SIZE,
    court: filters.court,
    query: filters.query,
    party: filters.party,
    firm: filters.firm,
    decided: filters.decided,
    opinion: filters.opinion,
    verified: filters.verified,
    fromYear: filters.fromYear,
    toYear: filters.toYear,
    sort: filters.sort,
    before: filters.before ? decodeCaseCursor(filters.before) : null,
  };
}

function statusFor(legalCase: PublicCaseListItem) {
  // Internal review states are never shown to readers; only the court outcome stage.
  return legalCase.decidedOn ? { label: "Decided", tone: styles.statusVerified } : { label: "Filed", tone: styles.statusPending };
}

function pageWindow(current: number, last: number) {
  const pages = new Set([1, last, current - 1, current, current + 1].filter((page) => page >= 1 && page <= last));
  return [...pages].sort((left, right) => left - right);
}

export default async function CasesPage({ searchParams }: { searchParams: Promise<CaseListingParams> }) {
  const filters = parseCaseListingParams(await searchParams);
  // Browsing traffic and crawlers reuse a five-minute snapshot. Searches containing
  // user-entered text stay live so free text never pollutes the shared cache.
  const [result, courts] = await Promise.all([
    // Paid subscribers' live text searches also include subscriber-only (sealed-style) records;
    // the shared snapshot never does.
    hasUserText(filters)
      ? listPublicCases(db(), { ...toQueryOptions(filters), includeSubscriberOnly: await viewerHasSubscriberAccess() })
      : listCachedPublicCases(toQueryOptions(filters)),
    listCachedPublicCaseCourts(),
  ]);
  const pages = result.totalApproximate ? 1 : Math.max(1, Math.ceil(result.total / result.pageSize));
  const activeCourt = filters.court ? courts.find((court) => court.value === filters.court) ?? null : null;
  const chips = activeFilterChips(filters, activeCourt?.label ?? null);
  const filtered = chips.length > 0;
  const compact = filters.density === "compact";
  const exact = result.page === 1 && result.cases[0] && exactMatchKind(filters.query, result.cases[0])
    ? { legalCase: result.cases[0], kind: exactMatchKind(filters.query, result.cases[0]) }
    : null;
  const sortOptions: CaseListingSort[] = filters.query ? ["best", "recent", "oldest", "az"] : ["recent", "oldest", "az"];
  const firstShown = result.cases.length === 0 ? 0 : result.totalApproximate ? 1 : (result.page - 1) * result.pageSize + 1;
  const lastShown = result.totalApproximate ? result.cases.length : Math.min(result.total, result.page * result.pageSize);
  const recordFilterCount = [filters.party, filters.firm, filters.court, filters.decided, filters.opinion, filters.verified, filters.fromYear || filters.toYear]
    .filter(Boolean).length;

  const hiddenFilterInputs = (omit: Array<keyof CaseListingFilters>) => (
    <>
      {filters.court && !omit.includes("court") ? <input type="hidden" name="court" value={filters.court} /> : null}
      {filters.party && !omit.includes("party") ? <input type="hidden" name="party" value={filters.party} /> : null}
      {filters.firm && !omit.includes("firm") ? <input type="hidden" name="firm" value={filters.firm} /> : null}
      {filters.decided && !omit.includes("decided") ? <input type="hidden" name="decided" value="1" /> : null}
      {filters.opinion && !omit.includes("opinion") ? <input type="hidden" name="opinion" value="1" /> : null}
      {filters.verified && !omit.includes("verified") ? <input type="hidden" name="verified" value="1" /> : null}
      {filters.fromYear && !omit.includes("fromYear") ? <input type="hidden" name="from" value={filters.fromYear} /> : null}
      {filters.toYear && !omit.includes("toYear") ? <input type="hidden" name="to" value={filters.toYear} /> : null}
      {compact && !omit.includes("density") ? <input type="hidden" name="view" value="compact" /> : null}
    </>
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.inner}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link href="/">Home</Link> <span aria-hidden="true">/</span> Cases
          </nav>
          <div className={styles.heroHeading}>
            <div>
              <h1>Find a federal court case</h1>
              <p>Search source-backed court records by case name, party, docket number, or citation. Every listing links back to the official record.</p>
            </div>
            <Link className={styles.verifyLink} href="/methodology">How Jurvio verifies records</Link>
          </div>
          <form className={styles.search} role="search" action="/cases">
            <label htmlFor="q" className={styles.visuallyHidden}>Search cases</label>
            <input id="q" name="q" type="search" defaultValue={filters.query ?? ""} placeholder="Case name, party, docket number, or citation" autoComplete="off" />
            {hiddenFilterInputs([])}
            <button type="submit">Search</button>
          </form>
        </div>
      </section>

      <div className={`${styles.inner} ${styles.layout}`}>
        <FilterDisclosure
          className={styles.filters}
          keepOpen={recordFilterCount > 0}
          summary={<>Filters{recordFilterCount > 0 ? ` · ${recordFilterCount}` : ""}</>}
        >
          <form action="/cases" className={styles.filterForm} aria-label="Filter cases">
            {filters.query ? <input type="hidden" name="q" value={filters.query} /> : null}
            {filters.sort !== (filters.query ? "best" : "recent") ? <input type="hidden" name="sort" value={filters.sort} /> : null}
            {compact ? <input type="hidden" name="view" value="compact" /> : null}

            <div className={styles.filterGroup}>
              <label htmlFor="court">Court</label>
              <select id="court" name="court" defaultValue={filters.court ?? ""}>
                <option value="">All courts</option>
                {courts.map((court) => (
                  <option key={court.value} value={court.value}>
                    {court.label} ({court.count.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="party">Party</label>
              <input id="party" name="party" type="search" defaultValue={filters.party ?? ""} placeholder="Find a party" autoComplete="off" />
              <Link href="/parties">Browse all parties</Link>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="firm">Law firm</label>
              <input id="firm" name="firm" type="search" defaultValue={filters.firm ?? ""} placeholder="Find a law firm" autoComplete="off" />
              <p>Firms come from counsel appearances in the published record. <Link href="/law-firms">Browse law firms</Link></p>
            </div>

            <fieldset className={styles.filterGroup}>
              <legend>Record</legend>
              <label className={styles.check}><input type="checkbox" name="decided" value="1" defaultChecked={filters.decided} /> Decision issued</label>
              <label className={styles.check}><input type="checkbox" name="opinion" value="1" defaultChecked={filters.opinion} /> Readable opinion</label>
              <label className={styles.check}><input type="checkbox" name="verified" value="1" defaultChecked={filters.verified} /> Status confirmed from court events</label>
            </fieldset>

            <fieldset className={styles.filterGroup}>
              <legend>Filed or decided</legend>
              <div className={styles.years}>
                <label>From<input name="from" inputMode="numeric" pattern="\d{4}" placeholder="YYYY" defaultValue={filters.fromYear ?? ""} /></label>
                <label>To<input name="to" inputMode="numeric" pattern="\d{4}" placeholder="YYYY" defaultValue={filters.toYear ?? ""} /></label>
              </div>
            </fieldset>

            <div className={styles.filterActions}>
              <button type="submit">Apply filters</button>
              {filtered ? <Link href="/cases">Reset all</Link> : null}
            </div>
          </form>
          <aside className={styles.trustNote}>
            <strong>Only cleared records appear here</strong>
            Cases appear here once the court&apos;s case details have been checked. <Link href="/public-records-policy">Publication policy</Link>
          </aside>
        </FilterDisclosure>

        <div className={styles.results}>
          {activeCourt ? (
            <section className={styles.courtCard} aria-label="Court profile">
              <div>
                <p className={styles.kicker}>Court</p>
                <p className={styles.courtName}>{activeCourt.label}</p>
                <p>Court information and every published case from this court.</p>
              </div>
              <Link href={`/courts/${activeCourt.value}` as Route}>Court profile →</Link>
            </section>
          ) : null}

          <div className={styles.resultHead}>
            <div>
              <h2 aria-live="polite">
                {result.totalApproximate ? "About " : ""}{result.total.toLocaleString()} {filtered ? "matching" : "published"} {result.total === 1 ? "case" : "cases"}
              </h2>
              <p>{SORT_DESCRIPTIONS[result.sort]}</p>
            </div>
            <div className={styles.controls}>
              <nav aria-label="Sort cases" className={styles.segmented}>
                {sortOptions.map((option) => (
                  <Link
                    key={option}
                    href={buildCaseListingHref({ ...filters, page: 1 }, { sort: option }) as Route}
                    aria-current={result.sort === option ? "true" : undefined}
                    rel="nofollow"
                  >
                    {SORT_LABELS[option]}
                  </Link>
                ))}
              </nav>
              <nav aria-label="Density" className={styles.segmented}>
                <Link href={buildCaseListingHref(filters, { density: "comfortable" }) as Route} aria-current={!compact ? "true" : undefined} rel="nofollow">Comfortable</Link>
                <Link href={buildCaseListingHref(filters, { density: "compact" }) as Route} aria-current={compact ? "true" : undefined} rel="nofollow">Compact</Link>
              </nav>
            </div>
          </div>

          {chips.length > 0 ? (
            <ul className={styles.chips} aria-label="Active filters">
              {chips.map((chip) => (
                <li key={chip.label}>
                  <Link href={chip.href as Route} aria-label={`Remove filter ${chip.label}`}>
                    {chip.label}<span aria-hidden="true">×</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {exact ? (
            <Link className={styles.exactMatch} href={`/case/${exact.legalCase.publicId}` as Route}>
              <span className={styles.exactKind}>{exact.kind === "citation" ? "Citation match" : "Docket match"}</span>
              <span className={styles.exactCaption}>
                <BrandedCaseCaption caption={exact.legalCase.caption} />
                <span> · {exact.legalCase.docketNumber}</span>
              </span>
              <span className={styles.exactGo}>Go to case →</span>
            </Link>
          ) : null}

          {result.cases.length === 0 ? (
            <section className={styles.empty}>
              <h2>No public cases match yet</h2>
              <p>Try a shorter party name, the docket number alone, or remove a filter. Some cases may not be on Jurvio yet.</p>
              <Link href="/cases">Clear search and filters</Link>
            </section>
          ) : (
            <ol className={`${styles.list} ${compact ? styles.compact : ""}`}>
              {result.cases.map((legalCase) => {
                const status = statusFor(legalCase);
                const latest = pickLatestCaseEvent(legalCase);
                const latestDate = latest ? formatPublicCaseDate(latest.date) ?? latest.date : null;
                const authorJudge = legalCase.perCuriam ? null : matchOpinionAuthorJudge(legalCase.opinionAuthor, legalCase.authorJudges ?? []);
                return (
                  <li key={legalCase.publicId}>
                    <article className={styles.caseRow}>
                      <div className={styles.caseMain}>
                        <div className={styles.meta}>
                          <span className={styles.court}>{legalCase.courtName}</span>
                          <span className={styles.mono}>{legalCase.docketNumber}</span>
                          {legalCase.officialCitation ? <span className={styles.mono}>{legalCase.officialCitation}</span> : null}
                          {legalCase.perCuriam ? <span>Per curiam opinion</span> : legalCase.opinionAuthor ? (
                            <span>
                              Opinion by{" "}
                              {authorJudge
                                ? <Link href={`/judges/${authorJudge.publicId}` as Route} className={styles.authorLink}>{legalCase.opinionAuthor}</Link>
                                : legalCase.opinionAuthor}
                            </span>
                          ) : null}
                        </div>
                        <h3>
                          <Link href={`/case/${legalCase.publicId}` as Route}>
                            <BrandedCaseCaption caption={legalCase.caption} highlight={filters.query} />
                          </Link>
                        </h3>
                        {!compact && legalCase.holding ? (
                          <p className={styles.holding}>
                            <span className={styles.kind}>Holding</span>{" "}
                            <HighlightedText text={legalCase.holding} highlight={filters.query} />
                          </p>
                        ) : null}
                        <div className={styles.facts}>
                          <span className={`${styles.status} ${status.tone}`}><span aria-hidden="true" />{status.label}</span>
                          {latest ? (
                            <span className={styles.latest}>
                              <span>Latest:</span> <strong>{truncateLabel(latest.label)}</strong>{latestDate ? ` · ${latestDate}` : ""}
                            </span>
                          ) : null}
                          {legalCase.hasPublicDocument ? <span className={styles.readable}>Readable opinion</span> : null}
                        </div>
                      </div>
                      <div className={styles.actions}>
                        {legalCase.officialCitation ? <CopyCitationButton citation={legalCase.officialCitation} className={styles.copy} /> : null}
                        <Link href={`/case/${legalCase.publicId}/timeline` as Route}>Timeline →</Link>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}

          {result.cases.length > 0 ? (
            <nav className={styles.pagination} aria-label="Case directory pages">
              <span>
                {result.totalApproximate
                  ? `Showing ${result.cases.length.toLocaleString()} cases`
                  : `Showing ${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${result.total.toLocaleString()}`}
              </span>
              <div>
                {result.totalApproximate ? (
                  <>
                    {filters.before
                      ? <Link href={buildCaseListingHref(filters, { before: null, page: 1 }) as Route}>Previous</Link>
                      : <span aria-disabled="true">Previous</span>}
                    {result.nextBefore
                      ? <Link href={buildCaseListingHref(filters, { before: encodeCaseCursor(result.nextBefore), page: 1 }) as Route}>Next</Link>
                      : <span aria-disabled="true">Next</span>}
                  </>
                ) : (
                  <>
                    {result.page > 1
                      ? <Link href={buildCaseListingHref(filters, { page: result.page - 1 }) as Route}>Previous</Link>
                      : <span aria-disabled="true">Previous</span>}
                    {pageWindow(result.page, pages).map((pageNumber, index, all) => (
                      <span key={pageNumber} className={styles.pageGroup}>
                        {index > 0 && pageNumber - (all[index - 1] ?? 0) > 1 ? <span className={styles.gap}>…</span> : null}
                        {pageNumber === result.page
                          ? <span aria-current="page" className={styles.currentPage}>{pageNumber}</span>
                          : <Link href={buildCaseListingHref(filters, { page: pageNumber }) as Route}>{pageNumber}</Link>}
                      </span>
                    ))}
                    {result.page < pages
                      ? <Link href={buildCaseListingHref(filters, { page: result.page + 1 }) as Route}>Next</Link>
                      : <span aria-disabled="true">Next</span>}
                  </>
                )}
              </div>
            </nav>
          ) : null}
        </div>
      </div>
    </main>
  );
}
