import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { siteOrigin } from "@/lib/config/site-url";
import { getExplainer, legalExplainers } from "@/modules/explainers/domain/explainers";
import styles from "../explainers.module.css";

interface Props { params: Promise<{ slug: string }> }
export function generateStaticParams() { return legalExplainers.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = getExplainer((await params).slug);
  if (!item) return {};
  return { title: `${item.term}, explained simply`, description: item.oneLine, alternates: { canonical: `/explainers/${item.slug}` } };
}

export default async function ExplainerPage({ params }: Props) {
  const item = getExplainer((await params).slug);
  if (!item) notFound();
  const origin = siteOrigin();
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Article", headline: `${item.term}, explained simply`,
    description: item.oneLine, url: `${origin}/explainers/${item.slug}`, dateModified: item.reviewedOn,
    author: { "@type": "Organization", name: "Jurvio", url: origin }, publisher: { "@type": "Organization", name: "Jurvio", url: origin },
    about: item.aliases.map((name) => ({ "@type": "Thing", name })), isAccessibleForFree: true,
  };
  return <main className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
    <article className={styles.article}><div className={`${styles.inner} ${styles.articleGrid}`}>
      <div>
        <nav className={styles.crumb} aria-label="Breadcrumb"><Link href={"/explainers" as Route}>Explainers</Link> / {item.term}</nav>
        <p className={styles.eyebrow}>{item.category}</p><h1>{item.term}</h1><p className={styles.definition}>{item.oneLine}</p>
        <section className={styles.section}><h2>What it means</h2><p>{item.plainEnglish}</p></section>
        <section className={styles.section}><h2>Why it matters</h2><p>{item.whyItMatters}</p></section>
        <section className={styles.section}><h2>What usually happens next</h2><ol>{item.whatHappensNext.map((step) => <li key={step}>{step}</li>)}</ol></section>
        <section className={styles.section}><h2>A common misunderstanding</h2><p>{item.commonMistake}</p></section>
        <section className={styles.section}><h2>Simple example</h2><p className={styles.example}>{item.example}</p></section>
        <section className={styles.section}><h2>Important note</h2><p>This is general educational information, not legal advice or a prediction about any case. The exact rule can depend on the court, jurisdiction, facts, and current law. Read the actual court order and consult a qualified attorney for advice about a specific matter.</p></section>
      </div>
      <aside className={styles.sidebar}>
        <section className={styles.sideCard}><h2>Related explanations</h2><ul>{item.related.map((slug) => { const related = getExplainer(slug); return related ? <li key={slug}><Link href={`/explainers/${slug}` as Route}>{related.term} →</Link></li> : null; })}</ul></section>
        <section className={`${styles.sideCard} ${styles.sources}`}><h2>Sources and reference points</h2><ul>{item.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a><span>{source.note}</span></li>)}</ul></section>
        <section className={styles.sideCard}><h2>Review status</h2><p>Source-framed and written without case-specific commentary.</p><time dateTime={item.reviewedOn}>Reviewed {new Date(`${item.reviewedOn}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })}</time></section>
      </aside>
    </div></article>
  </main>;
}
