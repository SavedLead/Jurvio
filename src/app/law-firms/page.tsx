import type { Metadata } from "next";
import { db } from "@/db/client";
import { listPublicLawFirms } from "@/modules/directory/application/professional-directory";
import { LawFirmDirectory } from "@/modules/directory/ui/professional-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Law Firms in Public Court Records",
  description: "Browse law firms connected to source-backed public court records on Jurvio.",
  alternates: { canonical: "/law-firms" },
};

export default async function LawFirmsPage() {
  const firms = await listPublicLawFirms(db());
  return <main className={styles.page}>
    <header className={styles.hero}><p className={styles.eyebrow}>Public legal directory</p><h1>Law firms</h1>
      <p>Law-firm records connected to published litigation, with links back to the underlying public cases.</p></header>
    <LawFirmDirectory records={firms} />
  </main>;
}
