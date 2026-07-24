import Link from "next/link";
import type { Route } from "next";

export type TrustSection = {
  title: string;
  paragraphs: readonly string[];
};

export function TrustPage({
  eyebrow,
  title,
  introduction,
  sections,
}: {
  eyebrow: string;
  title: string;
  introduction: string;
  sections: readonly TrustSection[];
}) {
  return (
    <main className="trustPage">
      <header className="trustPageHeader">
        <div className="shell">
          <p className="eyebrow"><span aria-hidden="true" /> {eyebrow}</p>
          <h1>{title}</h1>
          <p>{introduction}</p>
        </div>
      </header>
      <div className="shell trustPageLayout">
        <aside>
          <strong>Trust center</strong>
          <Link href={"/coverage" as Route}>Coverage</Link>
          <Link href={"/methodology" as Route}>Methodology</Link>
          <Link href={"/editorial-standards" as Route}>Editorial standards</Link>
          <Link href={"/public-records-policy" as Route}>Public-records policy</Link>
        </aside>
        <article>
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
          <div className="trustNotice">
            Jurvio is an independent public legal-information platform. Jurvio is not a court,
            law firm, or substitute for the official court record.
          </div>
        </article>
      </div>
    </main>
  );
}
