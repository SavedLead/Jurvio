import type { Metadata, Route } from "next";
import Link from "next/link";
import { TOPICS } from "@/modules/accounts/domain/topics";
import { KIND_EXPLAINER, TIMING_NOTE } from "@/modules/accounts/domain/entity-follow";
import { FollowEntityButton } from "@/modules/accounts/ui/follow-entity-button";
import styles from "@/modules/directory/ui/directory.module.css";
import "./topics.css";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Topics — Follow Federal Cases by Subject",
  description: "Browse public federal cases by subject (nature of suit) and follow a topic to get email alerts about new cases, filings and decisions.",
  alternates: { canonical: "/topics" },
  // Thin until topic pages carry more than a recent-case list; reconsider after launch.
  robots: { index: false, follow: true },
};

export default function TopicsPage() {
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/cases">Cases</Link> / Topics</nav>
    <header className={styles.profileHeader}>
      <p className={styles.eyebrow}>Browse and follow</p>
      <h1>Topics</h1>
      <p>Topics group federal cases by the “nature of suit” recorded when the case was filed. Follow a topic to get email alerts. {KIND_EXPLAINER.topic}</p>
      <p className="topicsTiming">{TIMING_NOTE}</p>
    </header>
    <section className={styles.section} aria-label="All topics">
      <ul className="topicsGrid">
        {TOPICS.map((topic) => <li key={topic.slug} className="topicsCard">
          <div>
            <h2><Link href={`/topics/${topic.slug}` as Route}>{topic.label}</Link></h2>
            <p>{topic.description}</p>
          </div>
          <FollowEntityButton kind="topic" target={topic.slug} name={topic.label} compact />
        </li>)}
      </ul>
    </section>
  </main>;
}
