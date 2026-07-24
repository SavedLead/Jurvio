import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { legalExplainers, type ExplainerCategory } from "@/modules/explainers/domain/explainers";
import styles from "./explainers.module.css";

export const metadata: Metadata = {
  title: "Legal procedure explained in plain English",
  description: "Understand jurisdiction, motions, dismissal, summary judgment, trial, appeal, injunctions, settlement, and other court procedures.",
  alternates: { canonical: "/explainers", types: { "application/json": "/explainers/glossary.json" } },
};

const categories: ExplainerCategory[] = ["starting a case", "deciding a case", "ending or pausing a case"];

export default function ExplainersPage() {
  return <main className={styles.page}>
    <section className={styles.hero}><div className={styles.inner}>
      <p className={styles.eyebrow}>Legal procedures, made clear</p>
      <h1>Understand what the court is doing<span>.</span></h1>
      <p className={styles.lede}>Short, neutral explanations of the words and steps that shape a court case. Written for first-time readers without leaving out what matters.</p>
      <aside className={styles.notice}>General educational information only, not legal advice. Rules and outcomes can differ by court, jurisdiction, and case. Jurvio links each explanation to governing or official reference material.</aside>
    </div></section>
    <section className={styles.library}><div className={styles.inner}>
      {categories.map((category) => { const items = legalExplainers.filter((item) => item.category === category); return <section className={styles.category} key={category}>
        <div className={styles.categoryHead}><h2>{category}</h2><span>{items.length} explanations</span></div>
        <div className={styles.grid}>{items.map((item) => <Link className={styles.card} key={item.slug} href={`/explainers/${item.slug}` as Route}>
          <small>{item.category}</small><h3>{item.term}</h3><p>{item.oneLine}</p><span className={styles.arrow}>Read explanation →</span>
        </Link>)}</div>
      </section>; })}
    </div></section>
  </main>;
}
