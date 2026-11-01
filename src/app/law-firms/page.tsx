import type { Metadata } from "next";
import { db } from "@/db/client";
import { listPublicEntities } from "@/modules/directory/application/public-directory";
import { EntityDirectory } from "@/modules/directory/ui/entity-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Law Firms in Public Court Records",
  description: "Browse law firms connected to source-backed public court records on Jurvio.",
  alternates: { canonical: "/law-firms" },
};

export default async function LawFirmsPage() {
  const firms = await listPublicEntities(db(), "law_firm");
  return <main className={styles.page}>
    <header className={styles.hero}><p className={styles.eyebrow}>Public legal directory</p><h1>Law firms</h1>
      <p>Law-firm records connected to published litigation, with links back to the underlying public cases.</p></header>
    <EntityDirectory records={firms} hrefPrefix="/law-firms" emptyTitle="Law-firm profiles are coming soon" emptyDescription="We only connect a firm to a case when the court record clearly names it, so these profiles are still being built. In the meantime, you can search cases by name." />
  </main>;
}
