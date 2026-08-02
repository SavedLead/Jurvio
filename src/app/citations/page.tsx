import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { lookupPublicCitation } from "@/modules/citations/application/lookup-public-citation";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import styles from "./citations.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Legal citation lookup", description: "Find publication-approved Jurvio case records by legal citation.", alternates: { canonical: "/citations" }, robots: { index: false, follow: true } };
type Params = { q?: string };

export default async function CitationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams; const query = (raw.q ?? "").trim();
  const result = query ? await lookupPublicCitation(db(), query) : null;
  return <main className={styles.page}><div className={styles.inner}>
    <p className={styles.eyebrow}>Jurvio Citation</p><h1>Start with the authority.</h1>
    <p className={styles.lede}>Enter a case citation to find its verified public record. Jurvio matches punctuation-insensitively but never substitutes a merely similar authority.</p>
    <form className={styles.lookup} action="/citations" role="search"><label htmlFor="citation">Case citation</label><div><input id="citation" name="q" defaultValue={query} placeholder="410 U.S. 113" maxLength={180} autoComplete="off"/><button>Check citation</button></div><p>Examples: 410 U.S. 113 · 347 U.S. 483 · 123 F.3d 456</p></form>
    {result ? <section className={styles.results} aria-live="polite"><div className={styles.resultHeading}><h2>{result.matches.length ? `${result.matches.length} exact ${result.matches.length === 1 ? "match" : "matches"}` : "No exact published match"}</h2>{result.parsed ? <code>{result.parsed.display}</code> : null}</div>
      {result.matches.length ? <ul>{result.matches.map(match => <li key={match.casePublicId}><div><p>{match.courtName}{match.decidedOn ? ` · ${match.decidedOn}` : ""}</p><h3><Link href={`/case/${match.casePublicId}` as Route}>{cleanCaseCaption(match.caption)}</Link></h3><dl><div><dt>Citation</dt><dd>{match.officialCitation}</dd></div><div><dt>Docket</dt><dd>{match.docketNumber}</dd></div></dl></div><Link href={`/case/${match.casePublicId}` as Route}>Open record →</Link></li>)}</ul>
      : <div className={styles.empty}><p>Jurvio did not find that exact citation among cases currently approved for public display.</p><p>Check the reporter abbreviation, volume, and first page. A missing match does not mean the authority is invalid or nonexistent.</p><Link href={`/search?q=${encodeURIComponent(query)}` as Route}>Search opinion text instead →</Link></div>}</section> : null}
    <aside className={styles.guardrail}><strong>What this check means</strong><p>An exact match verifies that Jurvio has a publication-approved record at that citation. It is not yet a determination that the case remains good law. Treatment analysis will appear only when Jurvio can show the later authority, exact passage, court relationship, and confidence behind the result.</p></aside>
    <section className={styles.next}><h2>Built for more than formatting</h2><div><article><strong>Verify</strong><p>Confirm the authority exists and that the caption, court, reporter, year, and first page agree.</p></article><article><strong>Trace</strong><p>Follow direct history and every later citing decision, filtered by court, date, treatment, and depth.</p></article><article><strong>Prove</strong><p>Open the exact language behind a treatment warning, quotation, or pinpoint citation.</p></article></div></section>
  </div></main>;
}
