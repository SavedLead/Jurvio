"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { glossaryStages, glossaryTerms, procedureTracks, type GlossaryTrack } from "@/modules/explainers/domain/glossary";
import styles from "./explainers.module.css";

const tracks: { id: "all" | GlossaryTrack; label: string }[] = [
  { id: "all", label: "All courts" }, { id: "general", label: "General" },
  { id: "federal", label: "Federal" }, { id: "state", label: "State" }, { id: "scotus", label: "Supreme Court" },
];

export function GlossaryBrowser() {
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState<(typeof tracks)[number]["id"]>("all");
  const q = query.trim().toLocaleLowerCase();
  const terms = useMemo(() => glossaryTerms.filter((item) => {
    const courtMatch = track === "all" || item.track === track || item.track === "general";
    const textMatch = !q || [item.term, item.definition, ...(item.aliases ?? [])].some((value) => value.toLocaleLowerCase().includes(q));
    return courtMatch && textMatch;
  }), [q, track]);

  return <>
    <section className={styles.roadmaps} aria-labelledby="roadmap-title">
      <div className={styles.sectionTitle}><p className={styles.eyebrow}>Procedure roadmaps</p><h2 id="roadmap-title">The path depends on the court.</h2><p>Legal terms form the vocabulary. These roadmaps show the usual order of events without implying that every case follows every step.</p></div>
      <div className={styles.roadmapGrid}>{procedureTracks.map((item) => <article className={styles.roadmap} key={item.id}><h3>{item.label}</h3><ol>{item.steps.map((step) => <li key={step}>{step}</li>)}</ol></article>)}</div>
    </section>
    <section className={styles.glossary} aria-labelledby="glossary-title">
      <div className={styles.sectionTitle}><p className={styles.eyebrow}>Legal dictionary</p><h2 id="glossary-title">Find a term in plain English.</h2><p>{glossaryTerms.length} frequently encountered terms, organized by where they tend to appear in a case.</p></div>
      <div className={styles.tools}>
        <label><span>Search terms and phrases</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “stay,” “cert denied,” or “deposition”" /></label>
        <div className={styles.filters} aria-label="Filter by court">{tracks.map((item) => <button aria-pressed={track === item.id} key={item.id} onClick={() => setTrack(item.id)}>{item.label}</button>)}</div>
      </div>
      <p className={styles.resultCount} aria-live="polite">{terms.length} {terms.length === 1 ? "term" : "terms"}</p>
      {glossaryStages.map((stage) => {
        const stageTerms = terms.filter((item) => item.stage === stage).sort((a, b) => b.popularity - a.popularity || a.term.localeCompare(b.term));
        if (!stageTerms.length) return null;
        return <section className={styles.termGroup} key={stage}><h3>{stage}</h3><dl>{stageTerms.map((item) => <div className={styles.term} key={`${item.track}-${item.term}`}><dt>{item.explainerSlug ? <Link href={`/explainers/${item.explainerSlug}` as Route}>{item.term}</Link> : item.term}{item.track !== "general" && <span>{item.track}</span>}</dt><dd>{item.definition}{item.aliases?.length ? <small>Also: {item.aliases.join(", ")}</small> : null}</dd></div>)}</dl></section>;
      })}
      {!terms.length && <p className={styles.empty}>No exact match. Try a shorter word or a different court filter.</p>}
    </section>
  </>;
}
