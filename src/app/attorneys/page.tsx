import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { listPublicUsaoAttorneys } from "@/modules/usao/application/public-usao-attorneys";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Federal Prosecutors in Public Court Records | Jurvio",
  description: "Source-backed profiles for U.S. Attorneys and Assistant U.S. Attorneys connected to public federal court records.",
  alternates: { canonical: "/attorneys" },
};

export default async function AttorneysPage() {
  const attorneys = await listPublicUsaoAttorneys(db(), 1000);
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Public legal directory</p><h1>Federal prosecutors</h1>
    <p>Verified professional profiles connected to official DOJ sources and documented federal court appearances.</p>
  </header><aside className={styles.notice}>A case appears on an individual profile only when a public source identifies that attorney. Office-level attribution alone is never assigned to every attorney.</aside>
  {attorneys.length ? <ol className={styles.list}>{attorneys.map((attorney) => <li key={attorney.publicId}><article className={styles.card}>
    <h2><Link href={`/attorneys/${attorney.publicId}`}>{attorney.displayName}</Link></h2>
    <p>{attorney.title ?? "Federal prosecutor"} · {attorney.officeDisplayName}</p>
    <dl><div><dt>Documented cases</dt><dd>{attorney.caseCount.toLocaleString()}</dd></div>
      <div><dt>Latest appearance</dt><dd>{attorney.latestAppearanceOn ?? "Not yet available"}</dd></div>
      <div><dt>Profile coverage</dt><dd>{attorney.profileCompleteness}%</dd></div></dl>
  </article></li>)}</ol> : <section className={styles.empty}><h2>Attorney roster backfill is running</h2>
    <p>Profiles will publish as official identities and court appearances clear Jurvio&apos;s verification rules.</p></section>}
  </main>;
}
