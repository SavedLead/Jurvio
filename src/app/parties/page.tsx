import type { Metadata } from "next";
import { db } from "@/db/client";
import { listPublicEntities } from "@/modules/directory/application/public-directory";
import { EntityDirectory } from "@/modules/directory/ui/entity-directory";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Parties in Public Court Cases",
  description: "Browse parties connected to source-backed public court cases on Jurvio.",
  alternates: { canonical: "/parties" },
};

export default async function PartiesPage() {
  const parties = await listPublicEntities(db(), "party");
  return <main className={styles.page}>
    <header className={styles.hero}><p className={styles.eyebrow}>Public legal directory</p><h1>Parties</h1>
      <p>People, companies, and public bodies appearing in court records Jurvio is permitted to display. A listing describes an appearance in a case, not wrongdoing or liability.</p></header>
    <EntityDirectory records={parties} hrefPrefix="/parties" emptyTitle="Party profiles are coming soon" emptyDescription="Profiles for people, companies, and agencies named in cases are still being built. In the meantime, search cases by a party's name." />
  </main>;
}
