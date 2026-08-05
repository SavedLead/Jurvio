import type { Metadata } from "next";
import { db } from "@/db/client";
import { listPublicAttorneys } from "@/modules/directory/application/professional-directory";
import { AttorneyDirectory } from "@/modules/directory/ui/professional-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attorneys in Public Court Records",
  description: "Attorney profiles connected to source-backed public court records on Jurvio.",
  alternates: { canonical: "/attorneys" },
};

export default async function AttorneysPage() {
  const attorneys = await listPublicAttorneys(db());
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Public legal directory</p><h1>Attorneys</h1>
    <p>Verified attorney identities connected to cases, courts, and law firms through qualifying public sources.</p>
  </header><AttorneyDirectory records={attorneys} /></main>;
}
