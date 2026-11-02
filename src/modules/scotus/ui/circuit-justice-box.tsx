import Link from "next/link";
import type { Route } from "next";
import {
  ALLOTMENT_EFFECTIVE,
  ALLOTMENT_SOURCE_URL,
  APPLICATIONS_GUIDE_URL,
  type CircuitJustice,
} from "@/modules/scotus/domain/circuit-justice";
import styles from "./circuit-justice.module.css";

function effectiveLabel(): string {
  return new Date(`${ALLOTMENT_EFFECTIVE}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * "Circuit Justice" box: the Supreme Court justice allotted to this court's
 * circuit, from the Court's allotment order, and what that means in plain words.
 * `relation` says how the page relates to the circuit (the circuit itself, a court in it, or the court below).
 */
export function CircuitJusticeBox({ justice, relation, compact = false }: {
  justice: CircuitJustice;
  relation: "circuit" | "court-in-circuit" | "court-below";
  compact?: boolean;
}) {
  const where = justice.states.length ? ` (${justice.states.join(", ")})` : "";
  const subject = relation === "circuit" ? `this circuit${where}`
    : relation === "court-in-circuit" ? `the ${justice.circuitName}${where}, where this court sits,`
    : `the ${justice.circuitName}, the court this case came from,`;
  const name = <Link href={`/justices/${justice.justiceSlug}` as Route}>{justice.justiceName}</Link>;
  return <aside className={`${styles.box} ${compact ? styles.compact : ""}`} aria-labelledby={`circuit-justice-${justice.circuit}`} data-circuit={justice.circuit}>
    <p className={styles.kicker}>Circuit Justice</p>
    <h3 id={`circuit-justice-${justice.circuit}`}>{name}, {justice.title}</h3>
    {compact
      ? <p>Handles emergency requests to the Supreme Court (called <em>applications</em>, such as a request to pause a ruling) from {relation === "court-below" ? `the ${justice.circuitName}, where this case came from` : `the ${justice.circuitName}`} first, and may act alone or refer them to the full Court.</p>
      : <p>The Supreme Court assigns each federal circuit to one of its justices. Emergency requests to the Supreme Court (called <em>applications</em>, such as a request to pause a lower court’s ruling) in cases from {subject} go first to this justice, who may act alone or refer the request to the full Court.</p>}
    <p className={styles.sources}>
      Sources: <a href={ALLOTMENT_SOURCE_URL} rel="noopener">Supreme Court allotment order (effective {effectiveLabel()})</a> · <a href={APPLICATIONS_GUIDE_URL} rel="noopener">The Court’s guide to applications (PDF)</a>
    </p>
  </aside>;
}
