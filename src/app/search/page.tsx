import type { Metadata, Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { listOpinionSearchFacets, normalizeOpinionSearchFilters, searchPublicOpinions } from "@/modules/search/application/search-public-opinions";
import styles from "./search.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Search published court opinions",
  description: "Search source-backed public court opinions by keyword, court, date, precedential status, and opinion type.",
  alternates: { canonical: "/search" }, robots: { index: false, follow: true },
};
type Params = { q?:string;court?:string;from?:string;to?:string;status?:string;type?:string;sort?:string;page?:string };
function cleanExcerpt(value:string){return value.replaceAll(/<[^>]*>/g, "");}
function label(value:string){return value.replace(/^\d{3}-/,"").replaceAll("-"," ");}
function pageHref(params:Params,page:number){const next=new URLSearchParams();for(const [key,value] of Object.entries(params)){if(value&&key!=="page")next.set(key,value);}next.set("page",String(page));return `/search?${next}` as Route;}

export default async function SearchPage({ searchParams }:{searchParams:Promise<Params>}) {
  const raw=await searchParams; const filters=normalizeOpinionSearchFilters(raw);
  const active=filters.query.length>=2||Boolean(filters.court||filters.dateFrom||filters.dateTo||filters.precedentialStatus||filters.opinionType);
  const [response,facets]=await Promise.all([searchPublicOpinions(db(),filters),listOpinionSearchFacets(db())]);
  if(active){const requestHeaders=await headers();await recordDemandEvent(db(),{eventType:"internal_search",userAgent:requestHeaders.get("user-agent"),referrer:requestHeaders.get("referer"),path:"/search",contentKind:"search",rawSearchQuery:filters.query,resultCount:response.total});}
  const pages=Math.max(1,Math.ceil(response.total/response.pageSize));
  return <main className={styles.page}><div className={styles.inner}>
    <p className={styles.eyebrow}>Jurvio research</p><h1 className={styles.heading}>Search published opinions</h1><p className={styles.lede}>Search readable court text, then narrow the record by court, filing date, precedential status, or opinion type.</p>
    <form className={styles.searchForm} action="/search" role="search">
      <div className={styles.queryRow}><input name="q" defaultValue={filters.query} aria-label="Keywords or case name" placeholder="Keywords, case name, citation, or legal issue"/><button>Search</button></div>
      <div className={styles.filters}>
        <div className={styles.field}><label htmlFor="court">Court</label><select id="court" name="court" defaultValue={filters.court??""}><option value="">All courts</option>{facets.courts.map(x=><option key={x.value} value={x.value}>{x.label} ({x.count})</option>)}</select></div>
        <div className={styles.field}><label htmlFor="status">Precedential status</label><select id="status" name="status" defaultValue={filters.precedentialStatus??""}><option value="">Any status</option>{facets.precedentialStatuses.map(x=><option key={x.value} value={x.value}>{label(x.label)} ({x.count})</option>)}</select></div>
        <div className={styles.field}><label htmlFor="type">Opinion type</label><select id="type" name="type" defaultValue={filters.opinionType??""}><option value="">Any type</option>{facets.opinionTypes.map(x=><option key={x.value} value={x.value}>{label(x.label)} ({x.count})</option>)}</select></div>
        <div className={styles.field}><label htmlFor="sort">Sort</label><select id="sort" name="sort" defaultValue={filters.sort}><option value="relevance">Relevance</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="most-cited">Most cited</option></select></div>
        <div className={styles.field}><label htmlFor="from">Filed after</label><input id="from" name="from" type="date" defaultValue={filters.dateFrom}/></div>
        <div className={styles.field}><label htmlFor="to">Filed before</label><input id="to" name="to" type="date" defaultValue={filters.dateTo}/></div>
      </div><div className={styles.filterActions}><button>Apply filters</button>{active?<Link href="/search">Clear all</Link>:null}</div>
    </form>
    <div className={styles.body}><section>
      <div className={styles.resultHead}><h2>{active?`${response.total.toLocaleString()} published ${response.total===1?"opinion":"opinions"}`:"Begin with keywords or a filter"}</h2><p>Draft and suppressed records are excluded.</p></div>
      {!active?<div className={styles.empty}><strong>Search the published legal record</strong><p>Enter a case name, citation, legal issue, or phrase. You can also browse by court or date without entering keywords.</p></div>:response.results.length===0?<div className={styles.empty}><strong>No published opinions match these filters</strong><p>Try fewer words, a broader date range, another court, or clear one of the filters.</p></div>:<div className={styles.results}>{response.results.map(result=><article className={styles.result} key={result.documentPublicId}><div className={styles.meta}><span>{result.courtName}</span>{result.filedOn?<span>{result.filedOn}</span>:null}<span>{label(result.opinionType)}</span>{result.precedentialStatus?<span>{label(result.precedentialStatus)}</span>:null}</div><h3><Link href={`/case/${result.casePublicId}/documents/${result.documentPublicId}` as Route}>{result.caseCaption}</Link></h3><p>{cleanExcerpt(result.excerpt)}</p><small>{result.title} · cited {result.citationCount.toLocaleString()} times in source data</small></article>)}</div>}
      {active&&pages>1?<nav className={styles.pagination} aria-label="Search result pages">{filters.page>1?<Link href={pageHref(raw,filters.page-1)}>← Previous</Link>:<span/>}<span>Page {filters.page} of {pages}</span>{filters.page<pages?<Link href={pageHref(raw,filters.page+1)}>Next →</Link>:<span/>}</nav>:null}
    </section><aside className={styles.side}><h2>How results are selected</h2><p>Jurvio searches published court text with deterministic full-text matching. Filters use source metadata. Citation totals are provider data, not a Jurvio rating.</p></aside></div>
  </div></main>;
}
