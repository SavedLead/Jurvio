import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listTopicCases } from "@/modules/accounts/application/topic-cases";
import { KIND_EXPLAINER, TIMING_NOTE } from "@/modules/accounts/domain/entity-follow";
import { TOPICS, topicBySlug } from "@/modules/accounts/domain/topics";
import { FollowEntityButton } from "@/modules/accounts/ui/follow-entity-button";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import styles from "@/modules/directory/ui/directory.module.css";
import "../topics.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const topic = topicBySlug((await params).slug);
  if (!topic) return { title: "Topic not found", robots: { index: false, follow: false } };
  return {
    title: `${topic.label} Cases — Follow New Federal Filings`,
    description: `Recent public federal ${topic.label.toLowerCase()} cases. ${topic.description} Follow the topic for email alerts.`,
    alternates: { canonical: `/topics/${topic.slug}` },
    robots: { index: false, follow: true },
  };
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = topicBySlug((await params).slug);
  if (!topic) notFound();
  const cases = await listTopicCases(db(), topic, 30);
  const others = TOPICS.filter((other) => other.slug !== topic.slug);
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={"/topics" as Route}>Topics</Link> / {topic.label}</nav>
    <header className={styles.profileHeader}>
      <p className={styles.eyebrow}>Topic</p>
      <h1>{topic.label}</h1>
      <p>{topic.description} Nature-of-suit codes {topic.ranges.map(([lo, hi]) => lo === hi ? String(lo) : `${lo}–${hi}`).join(", ")}.</p>
      <div className="topicFollow" id="follow">
        <FollowEntityButton kind="topic" target={topic.slug} name={topic.label} />
      </div>
      <p className="topicsTiming">{KIND_EXPLAINER.topic} {TIMING_NOTE}</p>
    </header>
    <section className={styles.section}>
      <h2>Recent public cases</h2>
      {cases === null ? <p>Recent cases are taking too long to load. Try again in a moment.</p>
        : cases.length === 0 ? <p>No public cases in this topic yet. Following it still alerts you when one appears.</p>
        : <ol className={styles.caseList}>{cases.map((item) => <li key={item.publicId}>
          <Link href={`/case/${item.publicId}` as Route}><div><h3>{cleanCaseCaption(item.caption)}</h3>
            <p>{[item.courtName, `Docket ${item.docketNumber}`, item.natureOfSuit].filter(Boolean).join(" · ")}</p></div>
            <time>{item.date ?? "Date unavailable"}</time></Link>
        </li>)}</ol>}
    </section>
    <section className={styles.section} aria-label="Other topics">
      <h2>Other topics</h2>
      <p className="topicsOther">{others.map((other, index) => <span key={other.slug}>{index ? " · " : ""}<Link href={`/topics/${other.slug}` as Route}>{other.label}</Link></span>)}</p>
    </section>
  </main>;
}
