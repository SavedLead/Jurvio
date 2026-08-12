import Link from "next/link";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getJudgeDetail } from "@/modules/judges/application/get-judge-detail";
import styles from "../judges.module.css";

export const dynamic = "force-dynamic";

const SERVICE_TYPE_LABEL: Record<string, string> = {
  article_iii_active: "Article III (active)",
  article_iii_senior: "Article III (senior)",
  chief: "Chief judge",
  magistrate: "Magistrate judge",
  bankruptcy: "Bankruptcy judge",
  territorial: "Territorial",
  federal_claims: "Federal Claims",
  visiting: "Visiting",
  recalled: "Recalled",
  other: "Other",
};
const AUTHORITY_LABEL: Record<string, string> = { article_iii: "Article III", article_i: "Article I" };

const day = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" }).format(new Date(value))
  : "—";
const ts = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value)) + " ET"
  : "—";

function factLabel(factType: string): string {
  return factType.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function factValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export default async function JudgeDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const { publicId } = await params;
  const judge = await getJudgeDetail(db(), publicId);
  if (!judge) notFound();

  const status = judge.serviceTerms.some((t) => t.serviceType === "article_iii_senior" && !t.endedOn)
    ? "Senior" : judge.active ? "Active" : "Former";

  return <main className={styles.page}>
    <nav>
      <Link href={"/internal/judges" as Route}>← Judge control center</Link>
      <a href={`/judges/${judge.publicId}`} target="_blank" rel="noreferrer">Public analytics ↗</a>
      {judge.officialProfileUrl ? <a href={judge.officialProfileUrl} target="_blank" rel="noreferrer">Official source ↗</a> : null}
    </nav>

    <header className={styles.header}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {judge.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={judge.photoUrl} alt={judge.displayName} width={96} height={120}
            style={{ borderRadius: 10, objectFit: "cover", border: "1px solid #e5e8ef" }} />
        ) : (
          <div aria-hidden style={{ width: 96, height: 120, borderRadius: 10, background: "#eef2f7",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 28, fontWeight: 700 }}>
            {judge.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </div>
        )}
        <div>
          <p>{AUTHORITY_LABEL[judge.authority] ?? judge.authority} judge</p>
          <h1>{judge.displayName}</h1>
          <span>{judge.courtName ?? "Court unmapped"}</span>
        </div>
      </div>
      <b className={status === "Former" ? styles.warn : styles.good}>{status}</b>
    </header>

    <section className={styles.kpis}>
      <article><span>Authority</span><strong>{AUTHORITY_LABEL[judge.authority] ?? "—"}</strong></article>
      <article><span>Service terms</span><strong>{judge.serviceTerms.length}</strong></article>
      <article><span>Case assignments</span><strong>{judge.assignments.toLocaleString()}</strong></article>
      <article><span>Analytics observations</span><strong>{judge.observations.toLocaleString()}</strong></article>
      <article><span>Publishing</span><strong className={judge.published ? styles.ok : styles.bad}>{judge.published ? "Published" : "Pending"}</strong></article>
      <article><span>Verification</span><strong>{judge.verification}</strong></article>
    </section>
    <p className={styles.fresh}>
      Identity: {judge.fjcNid ? `FJC ${judge.fjcNid}` : ""}{judge.fjcNid && judge.brmagId ? " · " : ""}
      {judge.brmagId ? `BR/MAG ${judge.brmagId}` : ""}{!judge.fjcNid && !judge.brmagId ? "—" : ""}
      . Judge type: {judge.judgeType ?? "—"}. Last updated {ts(judge.updatedAt)}.
    </p>

    <section className={styles.panel}><h2>Judicial service history</h2>
      <div className={styles.table}>
        <table>
          <thead><tr>
            <th>Court</th><th>Role</th><th>Branch</th><th>Commissioned</th><th>Start</th><th>End</th><th>Appointed by</th><th>Source</th>
          </tr></thead>
          <tbody>
            {judge.serviceTerms.map((t, i) => (
              <tr key={i}>
                <td>{t.courtName ?? "—"}</td>
                <td>{SERVICE_TYPE_LABEL[t.serviceType] ?? t.serviceType}</td>
                <td>{t.courtCategory ?? "—"}</td>
                <td>{day(t.commissionDate)}</td>
                <td>{day(t.startedOn)}</td>
                <td>{t.endedOn ? day(t.endedOn) : <span className={styles.ok}>Serving</span>}</td>
                <td>{t.appointingPresident ?? "—"}{t.appointingPresidentParty ? ` (${t.appointingPresidentParty})` : ""}</td>
                <td>{t.sourceUrl ? <a href={t.sourceUrl} target="_blank" rel="noreferrer">{t.sourceSystem}</a> : t.sourceSystem}</td>
              </tr>
            ))}
            {judge.serviceTerms.length === 0 ? <tr><td colSpan={8}>No service terms recorded.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>

    <section className={styles.panel}><h2>Biographical &amp; source data</h2>
      {judge.profileFacts.length ? (
        <div className={styles.table}>
          <table>
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>{judge.profileFacts.map((f, i) => (
              <tr key={i}><td>{factLabel(f.factType)}</td><td style={{ whiteSpace: "normal" }}>{factValue(f.value)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p style={{ color: "#667085" }}>No additional biographical facts ingested for this judge yet.</p>}
    </section>

    <section className={styles.panel}><h2>Known names</h2>
      <div className={styles.table}>
        <table>
          <thead><tr><th>Name</th><th>Type</th></tr></thead>
          <tbody>
            {judge.nameVariants.map((v, i) => <tr key={i}><td>{v.displayValue}</td><td>{v.variantType}</td></tr>)}
            {judge.nameVariants.length === 0 ? <tr><td colSpan={2}>No name variants recorded.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
