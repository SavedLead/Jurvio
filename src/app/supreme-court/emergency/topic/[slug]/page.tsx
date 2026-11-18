import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { FollowEntityButton } from "@/modules/accounts/ui/follow-entity-button";
import "@/modules/accounts/ui/follow-entity-button.css";
import { listEmergencyTopic } from "@/modules/scotus/application/emergency-topic-list";
import { emergencyTopicBySlug } from "@/modules/scotus/domain/emergency-topics";
import styles from "../../emergency.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const topic = emergencyTopicBySlug((await params).slug);
  if (!topic) return { title: "Topic not found" };
  return {
    title: `${topic.label}: Supreme Court emergency applications`,
    description: `${topic.description} Applications on the Supreme Court emergency docket.`,
    alternates: { canonical: `/supreme-court/emergency/topic/${topic.slug}` },
  };
}

export default async function EmergencyTopicPage({ params }: { params: Params }) {
  const slug = (await params).slug;
  const listed = await listEmergencyTopic(db(), slug);
  if (!listed) notFound();
  return <main className={styles.page}>
    <header className={`${styles.wrap} ${styles.hero}`}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Jurvio</Link><span>/</span><Link href="/supreme-court">Supreme Court</Link><span>/</span>
        <Link href={"/supreme-court/emergency" as Route}>Emergency docket</Link><span>/</span>{listed.topic.label}
      </nav>
      <h1>{listed.topic.label}</h1>
      <p className={styles.lede}>{listed.topic.description} Topic follows are a paid feature. Charging is off.</p>
      <FollowEntityButton kind="topic" target={listed.topic.slug} name={listed.topic.label} />
    </header>
    <section className={styles.wrap} aria-labelledby="topic-applications">
      <h2 id="topic-applications">Applications</h2>
      {listed.rows.length ? <ul>{listed.rows.map((row) => <li key={row.docketNumber}>
        <Link href={`/supreme-court/emergency/${row.docketNumber}` as Route}>No. {row.docketNumber}</Link> {row.caption}
      </li>)}</ul> : <p>No applications are tagged with this topic yet.</p>}
    </section>
  </main>;
}
