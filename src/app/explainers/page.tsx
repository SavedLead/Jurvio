import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { legalExplainers } from "@/modules/explainers/domain/explainers";
import { popularGlossaryTerms } from "@/modules/explainers/domain/glossary";
import { GlossaryBrowser } from "./glossary-browser";
import styles from "./explainers.module.css";

export const metadata: Metadata = {
  title: "Legal terms and court procedure explained",
  description: "Search plain-English definitions of common legal terms and follow federal, state, and U.S. Supreme Court procedure roadmaps.",
  alternates: { canonical: "/explainers" },
};

export default function ExplainersPage() {
  const popular = popularGlossaryTerms();
  return <main className={styles.page}>
    <section className={styles.hero}><div className={styles.inner}>
      <p className={styles.eyebrow}>Legal language, made clear</p>
      <h1>Understand the words and the process<span>.</span></h1>
      <p className={styles.lede}>Search the legal dictionary, follow the usual path through a court case, or read a deeper neutral explainer with examples and official sources.</p>
      <aside className={styles.notice}>General educational information only, not legal advice. Rules and outcomes differ by court, jurisdiction, and case.</aside>
      <nav className={styles.jump} aria-label="Explainer page sections"><a href="#popular">Popular terms</a><a href="#deep-explainers">Deep explainers</a><a href="#glossary-title">Full dictionary</a></nav>
    </div></section>
    <div className={styles.inner}>
      <section className={styles.popular} id="popular"><div className={styles.sectionTitle}><p className={styles.eyebrow}>Most encountered</p><h2>Popular legal terms</h2><p>Prominence is an editorial usage tier, not a claim of exact nationwide frequency. Jurvio can replace it with observed corpus counts as the case index grows.</p></div>
        <div className={styles.cloud}>{popular.map((item) => <span className={styles[`weight${item.popularity}`]} key={item.term}>{item.term}</span>)}</div>
      </section>
      <section className={styles.deep} id="deep-explainers"><div className={styles.sectionTitle}><p className={styles.eyebrow}>Go deeper</p><h2>Step-by-step explainers</h2><p>Longer explanations cover what a term means, why it matters, what usually happens next, a common misunderstanding, and a concrete example.</p></div>
        <div className={styles.grid}>{legalExplainers.map((item) => <Link className={styles.card} key={item.slug} href={`/explainers/${item.slug}` as Route}><small>{item.category}</small><h3>{item.term}</h3><p>{item.oneLine}</p><span className={styles.arrow}>Read explanation →</span></Link>)}</div>
      </section>
      <GlossaryBrowser />
    </div>
  </main>;
}
