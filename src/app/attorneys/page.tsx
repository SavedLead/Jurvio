import type { Metadata } from "next";
import styles from "@/modules/directory/ui/directory.module.css";

export const metadata: Metadata = {
  title: "Attorneys in Public Court Records",
  description: "Attorney profiles connected to source-backed public court records on Jurvio.",
  alternates: { canonical: "/attorneys" }, robots: { index: false, follow: true },
};

export default function AttorneysPage() {
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Public legal directory</p><h1>Attorneys</h1>
    <p>Attorney profiles will connect counsel to the cases, courts, filings, and law firms documented by qualifying public sources.</p>
  </header><section className={styles.empty}><h2>Attorney profiles are coming soon</h2>
    <p>We only connect a lawyer to a case when the court record clearly names them, so these profiles are still being built. In the meantime, you can search cases by name.</p>
    <p><a href="/search">Search court records →</a></p></section></main>;
}
