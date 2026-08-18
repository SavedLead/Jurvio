import type { Metadata } from "next";
import { db } from "@/db/client";
import { listPublicUsaoOffices } from "@/modules/usao/application/public-usao-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "U.S. Attorney's Offices | Jurvio",
  description: "Browse source-backed federal case activity by U.S. Attorney's Office.",
  alternates: { canonical: "/us-attorneys" },
};

export default async function UsAttorneysPage() {
  const offices = await listPublicUsaoOffices(db());
  return <main className={styles.page}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Federal government litigation</p>
      <h1>U.S. Attorney&apos;s Offices</h1>
      <p>Every office is mapped to its federal district. Case totals include only public records in which the United States is identified as the filing-side party, and reflect Jurvio&apos;s current verified corpus.</p>
    </header>
    <aside className={styles.notice}>Office-level case activity does not imply that every case was handled by every attorney in the office. Individual attorney profiles require a sourced signature, appearance, or official attribution.</aside>
    {offices.length ? <ol className={styles.list}>{offices.map((office) => <li key={office.publicId}>
      <article className={styles.card}>
        <h2>{office.displayName}</h2>
        <dl>
          <div><dt>Public cases</dt><dd>{office.caseCount.toLocaleString()}</dd></div>
          <div><dt>Active cases</dt><dd>{office.activeCaseCount.toLocaleString()}</dd></div>
          <div><dt>Attributed attorneys</dt><dd>{office.attorneyCount.toLocaleString()}</dd></div>
          <div><dt>Latest filed case</dt><dd>{office.latestCaseFiledOn ?? "Not yet available"}</dd></div>
        </dl>
      </article>
    </li>)}</ol> : <section className={styles.empty}><h2>USAO profiles are being prepared</h2><p>The office directory will appear as soon as the authoritative district mapping and source-backed case attribution migration completes.</p></section>}
  </main>;
}
