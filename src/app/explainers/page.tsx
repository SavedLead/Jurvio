import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { legalExplainers } from "@/modules/explainers/domain/explainers";
import { glossaryDomains, glossaryTerms, popularGlossaryTerms } from "@/modules/explainers/domain/glossary";
import { GlossaryBrowser } from "./glossary-browser";
import styles from "./explainers.module.css";

export const metadata: Metadata = {
  title: "Legal terms and court procedure explained",
  description: "Search plain-English legal definitions and understand court, agency, bankruptcy, criminal, family, immigration, arbitration, appellate, and Supreme Court procedure.",
  alternates: { canonical: "/explainers" },
  openGraph: {
    title: "Legal dictionary and court procedure explainers | Jurvio",
    description: "Plain-English legal terms, court processes, agency proceedings, bankruptcy, arbitration, and appeals.",
    type: "website",
    url: "/explainers",
  },
};

export default function ExplainersPage() {
  const popular = popularGlossaryTerms();
  const definedTermSet = {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: "Jurvio Legal Dictionary",
    description: "Plain-English definitions of legal terms across courts, agencies, tribunals, and areas of law.",
    url: "/explainers",
    hasDefinedTerm: glossaryTerms.map((item) => ({
      "@type": "DefinedTerm",
      name: item.term,
      description: item.definition,
      alternateName: item.aliases,
      inDefinedTermSet: "/explainers",
    })),
  };
  return <main className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(definedTermSet).replace(/</g, "\\u003c") }} />
    <section className={styles.hero}><div className={styles.inner}>
      <p className={styles.eyebrow}>Legal language, made clear</p>
      <h1>Understand the words and the process<span>.</span></h1>
      <p className={styles.lede}>Search the legal dictionary, follow the usual path through a court, agency, bankruptcy, or arbitration matter, or read a deeper neutral explainer with examples and official sources.</p>
      <aside className={styles.notice}>General educational information only, not legal advice. Rules and outcomes differ by court, jurisdiction, and case.</aside>
      <nav className={styles.jump} aria-label="Explainer page sections"><a href="#popular">Popular terms</a><a href="#deep-explainers">Deep explainers</a><a href="#glossary-title">Full dictionary</a></nav>
    </div></section>
    <div className={styles.inner}>
      <section className={styles.popular} id="popular"><div className={styles.sectionTitle}><p className={styles.eyebrow}>Most encountered</p><h2>Popular legal terms</h2><p>Prominence is an editorial usage tier, not a claim of exact nationwide frequency. Jurvio can replace it with observed corpus counts as the case index grows.</p></div>
        <div className={styles.cloud}>{popular.map((item) => <span className={styles[`weight${item.popularity}`]} key={item.term}>{item.term}</span>)}</div>
      </section>
      <section className={styles.deep} aria-labelledby="areas-title"><div className={styles.sectionTitle}><p className={styles.eyebrow}>Browse broadly</p><h2 id="areas-title">Areas of law and legal forums</h2><p>Jurvio’s coverage is designed to expand with the corpus. These categories are navigation aids, not limits on what belongs in the dictionary.</p></div>
        <div className={styles.areaGrid}>{glossaryDomains.map((area) => {
          const count = glossaryTerms.filter((item) => item.domains.includes(area.id)).length;
          return <article className={styles.areaCard} key={area.id}><h3>{area.label}</h3><p>{count} current definitions</p></article>;
        })}</div>
      </section>
      <section className={styles.deep} id="deep-explainers"><div className={styles.sectionTitle}><p className={styles.eyebrow}>Go deeper</p><h2>Step-by-step explainers</h2><p>Longer explanations cover what a term means, why it matters, what usually happens next, a common misunderstanding, and a concrete example.</p></div>
        <div className={styles.grid}>{legalExplainers.map((item) => <Link className={styles.card} key={item.slug} href={`/explainers/${item.slug}` as Route}><small>{item.category}</small><h3>{item.term}</h3><p>{item.oneLine}</p><span className={styles.arrow}>Read explanation →</span></Link>)}</div>
      </section>
      <GlossaryBrowser />
    </div>
  </main>;
}
