import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicUsaoAttorney } from "@/modules/usao/application/public-usao-attorneys";
import styles from "@/modules/directory/ui/directory.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ publicId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId } = await params;
  const attorney = await getPublicUsaoAttorney(db(), publicId);
  if (!attorney) return { title: "Attorney not found | Jurvio", robots: { index: false } };
  return {
    title: `${attorney.displayName} | Federal Prosecutor | Jurvio`,
    description: `Source-backed public professional profile and documented case activity for ${attorney.displayName}.`,
    alternates: { canonical: `/attorneys/${publicId}` },
  };
}

export default async function AttorneyProfilePage({ params }: Props) {
  const { publicId } = await params;
  const attorney = await getPublicUsaoAttorney(db(), publicId);
  if (!attorney) notFound();
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Federal prosecutor profile</p><h1>{attorney.displayName}</h1>
    <p>{attorney.title ?? "Federal prosecutor"} · {attorney.officeDisplayName}</p>
  </header><aside className={styles.notice}>This profile reports documented public professional activity. It does not rate the attorney, attribute every office case to this person, or infer participation without a source.</aside>
  <section className={styles.card}><h2>Public record summary</h2><dl>
    <div><dt>Documented cases</dt><dd>{attorney.caseCount.toLocaleString()}</dd></div>
    <div><dt>Latest appearance</dt><dd>{attorney.latestAppearanceOn ?? "Not yet available"}</dd></div>
    <div><dt>Division</dt><dd>{attorney.division ?? "Not published"}</dd></div>
    <div><dt>Last verified</dt><dd>{attorney.lastVerifiedAt ?? "Pending refresh"}</dd></div>
  </dl>{attorney.biography ? <p>{attorney.biography}</p> : null}
  {attorney.officialProfileUrl ? <p><a href={attorney.officialProfileUrl} rel="noreferrer">Official DOJ source</a></p> : null}</section>
  </main>;
}
