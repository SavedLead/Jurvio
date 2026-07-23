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
  </header><section className={styles.empty}><h2>No attorney profiles are published yet</h2>
    <p>The current canonical data model does not yet identify attorneys separately from parties. Jurvio will not infer or fabricate those relationships.</p></section></main>;
}
