"use client";

import { useMemo, useState } from "react";
import type { CourtMilestone } from "@/modules/scotus/domain/court-reference";
import styles from "./timeline.module.css";

type Category = "all" | CourtMilestone["category"];
type Importance = "all" | CourtMilestone["importance"];

export function TimelineFilter({ events }: { events: readonly CourtMilestone[] }) {
  const [category, setCategory] = useState<Category>("all");
  const [importance, setImportance] = useState<Importance>("major");
  const visible = useMemo(
    () => events.filter((event) => (category === "all" || event.category === category) && (importance === "all" || event.importance === importance)),
    [category, events, importance],
  );

  return (
    <>
      <div className={styles.filters} aria-label="Timeline filters">
        <label>Event type
          <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
            <option value="all">All types</option><option value="institution">Institution</option>
            <option value="membership">Court size and membership</option><option value="procedure">Procedure</option>
            <option value="publication">Public access</option>
          </select>
        </label>
        <label>Importance
          <select value={importance} onChange={(event) => setImportance(event.target.value as Importance)}>
            <option value="major">Major events</option><option value="all">Major and context</option>
          </select>
        </label>
        <p aria-live="polite">{visible.length} events shown</p>
      </div>
      <ol className={styles.timeline}>
        {visible.map((event) => (
          <li key={`${event.year}-${event.title}`}>
            <div className={styles.year}><strong>{event.year}</strong>{event.date ? <span>{event.date}</span> : null}</div>
            <article><div><span>{event.category}</span>{event.importance === "major" ? <b>Major</b> : null}</div><h2>{event.title}</h2><p>{event.description}</p></article>
          </li>
        ))}
      </ol>
    </>
  );
}
