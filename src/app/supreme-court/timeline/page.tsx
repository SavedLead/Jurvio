import type { Metadata } from "next";
import Link from "next/link";
import { courtMilestones } from "@/modules/scotus/domain/court-reference";
import { TimelineFilter } from "./timeline-filter";
import styles from "./timeline.module.css";

export const metadata: Metadata = {
  title: "Supreme Court Timeline",
  description: "Explore major events in the history, membership, procedure, and public record of the U.S. Supreme Court.",
  alternates: { canonical: "/supreme-court/timeline" },
};

export default function SupremeCourtTimelinePage() {
  return <main className={styles.page}>
    <header className={styles.hero}>
      <nav aria-label="Breadcrumb"><Link href="/">Jurvio</Link><span>/</span><Link href="/supreme-court">Supreme Court</Link><span>/</span>Timeline</nav>
      <p>1789 to today</p><h1>The Supreme Court timeline</h1>
      <div>Explore the laws, cases, membership changes, and publication milestones that shaped the Court. Filters separate defining events from useful historical context.</div>
    </header>
    <section className={styles.body}><TimelineFilter events={courtMilestones} /></section>
    <aside className={styles.sourceNote}><strong>Research note</strong><p>This institutional timeline is educational and selective, not a list of every case or change in Court personnel. Dates and Court-size history are grounded in official Supreme Court and congressional sources.</p><a href="https://www.supremecourt.gov/about/institution.aspx">Official history of the Court ↗</a></aside>
  </main>;
}
