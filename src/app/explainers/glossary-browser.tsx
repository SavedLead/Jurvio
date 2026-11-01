"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  glossaryDomains, glossaryJurisdictions, glossaryStages, glossaryTerms, procedureTracks,
  type GlossaryDomain, type GlossaryJurisdiction,
} from "@/modules/explainers/domain/glossary";
import { glossaryAdditions } from "@/modules/explainers/domain/glossary-additions";
import { termKey } from "@/modules/plain-english/domain/term-key";
import styles from "./explainers.module.css";

const allGlossaryTerms = [...glossaryTerms, ...glossaryAdditions];

export function GlossaryBrowser() {
  const [query, setQuery] = useState("");
  const [jurisdiction, setJurisdiction] = useState<"all" | GlossaryJurisdiction>("all");
  const [domain, setDomain] = useState<"all" | GlossaryDomain>("all");
  const q = query.trim().toLocaleLowerCase();
  const terms = useMemo(() => allGlossaryTerms.filter((item) => {
    const courtMatch = jurisdiction === "all" || item.jurisdiction === jurisdiction || item.jurisdiction === "general";
    const domainMatch = domain === "all" || item.domains.includes(domain);
    const textMatch = !q || [item.term, item.definition, ...(item.aliases ?? [])].some((value) => value.toLocaleLowerCase().includes(q));
    return courtMatch && domainMatch && textMatch;
  }), [domain, jurisdiction, q]);

  return <>
    <section className={styles.roadmaps} aria-labelledby="roadmap-title">
      <div className={styles.sectionTitle}><p className={styles.eyebrow}>Procedure roadmaps</p><h2 id="roadmap-title">The path depends on the forum and matter.</h2><p>Legal terms form the vocabulary. These roadmaps cover courts, agency proceedings, bankruptcy, and arbitration without implying that every matter follows every step.</p></div>
      <div className={styles.roadmapGrid}>{procedureTracks.map((item) => <article className={styles.roadmap} key={item.id}><h3>{item.label}</h3><ol>{item.steps.map((step) => <li key={step}>{step}</li>)}</ol></article>)}</div>
    </section>
    <section className={styles.glossary} aria-labelledby="glossary-title">
      <div className={styles.sectionTitle}><p className={styles.eyebrow}>Legal dictionary</p><h2 id="glossary-title">Find a term in plain English.</h2><p>{allGlossaryTerms.length} frequently encountered terms, organized by where they tend to appear in a case.</p></div>
      <div className={styles.tools}>
        <label><span>Search terms and phrases</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “stay,” “cert denied,” or “deposition”" /></label>
        <div>
          <span className={styles.filterLabel}>Jurisdiction or forum</span>
          <div className={styles.filters} aria-label="Filter by jurisdiction or forum">
            <button aria-pressed={jurisdiction === "all"} onClick={() => setJurisdiction("all")}>All forums</button>
            {glossaryJurisdictions.map((item) => <button aria-pressed={jurisdiction === item.id} key={item.id} onClick={() => setJurisdiction(item.id)}>{item.label}</button>)}
          </div>
          <span className={styles.filterLabel}>Area of law</span>
          <div className={styles.filters} aria-label="Filter by area of law">
            <button aria-pressed={domain === "all"} onClick={() => setDomain("all")}>All areas</button>
            {glossaryDomains.map((item) => <button aria-pressed={domain === item.id} key={item.id} onClick={() => setDomain(item.id)}>{item.label}</button>)}
          </div>
        </div>
      </div>
      <p className={styles.resultCount} aria-live="polite">{terms.length} {terms.length === 1 ? "term" : "terms"}</p>
      {glossaryStages.map((stage) => {
        const stageTerms = terms.filter((item) => item.stage === stage).sort((a, b) => b.popularity - a.popularity || a.term.localeCompare(b.term));
        if (!stageTerms.length) return null;
        return <section className={styles.termGroup} key={stage}><h3>{stage}</h3><dl>{stageTerms.map((item) => <div className={styles.term} id={`term-${termKey(item.term)}`} key={`${item.jurisdiction}-${item.term}`}><dt>{item.explainerSlug ? <Link href={`/explainers/${item.explainerSlug}` as Route}>{item.term}</Link> : item.term}{item.jurisdiction !== "general" && <span>{item.jurisdiction}</span>}</dt><dd>{item.definition}<small>{item.aliases?.length ? `Also: ${item.aliases.join(", ")} · ` : ""}{item.domains.join(" · ")}</small></dd></div>)}</dl></section>;
      })}
      {!terms.length && <p className={styles.empty}>No exact match. Try a shorter word or a different court filter.</p>}
    </section>
  </>;
}
