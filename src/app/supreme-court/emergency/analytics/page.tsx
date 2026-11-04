import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { robotsFor } from "@/lib/seo/indexing";
import { loadEmergencyAnalytics } from "@/modules/scotus/application/emergency-docket";
import { APPLICANT_KIND_LABEL } from "@/modules/scotus/domain/emergency-application";
import { emergencyProGate } from "@/modules/scotus/http/emergency-pro";
import styles from "../emergency.module.css";
import { justiceLabel } from "../format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Emergency docket analytics (Pro)",
  description: "Grant rates, time to decision and noted dissents on the Supreme Court emergency docket.",
  robots: robotsFor(false),
};

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export default async function EmergencyAnalyticsPage() {
  const gate = await emergencyProGate();
  const header = <header className={`${styles.wrap} ${styles.hero}`}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
      <Link href="/">Jurvio</Link><span>/</span><Link href="/supreme-court">Supreme Court</Link><span>/</span>
      <Link href={"/supreme-court/emergency" as Route}>Emergency docket</Link><span>/</span>Analytics
    </nav>
    <p className={styles.eyebrow}>Pro</p>
    <h1 style={{ fontSize: "clamp(32px,5vw,54px)" }}>Emergency docket analytics</h1>
    <p className={styles.lede}>Grant rates by who asked, time from filing to ruling, how often each circuit justice&apos;s applications go to the full Court, and publicly noted dissents.</p>
  </header>;

  if (!gate.ok) {
    return <main className={styles.page}>{header}
      <div className={`${styles.wrap}`} style={{ paddingBottom: 90 }}>
        <div className={styles.empty}>
          <h2>{gate.reason === "signed_out" ? "Sign in to see analytics" : "Analytics are part of Pro"}</h2>
          <p>{gate.reason === "signed_out"
            ? <><Link href={`/signin?next=${encodeURIComponent("/supreme-court/emergency/analytics")}` as Route} rel="nofollow">Sign in</Link> with a Pro or Team account. </>
            : <>Pro also includes 10-minute emergency alerts, a response-deadline calendar and CSV export. Paid plans are not on sale yet. </>}
            <Link href={"/pricing" as Route}>See plans</Link></p>
        </div>
      </div>
    </main>;
  }

  const data = await loadEmergencyAnalytics(db());
  return <main className={styles.page}>{header}
    <div className={`${styles.wrap}`} style={{ paddingBottom: 90 }}>
      {!data ? <div className={styles.empty}><h2>Analytics are not available right now</h2><p>Try again in a minute.</p></div> : <>
        <section className={styles.section} aria-labelledby="applicant-title">
          <h2 id="applicant-title">By who asked</h2>
          <dl className={styles.facts}>
            {data.byApplicant.map((row) => <div key={row.applicantKind}><dt>{APPLICANT_KIND_LABEL[row.applicantKind]}</dt>
              <dd>{pct(row.granted, row.decided)} granted<small>{row.granted} of {row.decided} decided{row.medianDays !== null ? ` · median ${row.medianDays} days to ruling` : ""}</small></dd></div>)}
          </dl>
        </section>
        {data.administrations.length ? <section className={styles.section} aria-labelledby="admin-title">
          <h2 id="admin-title">Federal government, by administration</h2>
          <dl className={styles.facts}>
            {data.administrations.map((row) => <div key={row.administration}><dt>{row.administration}</dt><dd>{pct(row.granted, row.decided)} granted<small>{row.granted} of {row.decided} decided</small></dd></div>)}
          </dl>
        </section> : null}
        <section className={styles.section} aria-labelledby="justice-title">
          <h2 id="justice-title">By circuit justice</h2>
          <dl className={styles.facts}>
            {data.byJustice.map((row) => <div key={row.justice}><dt>{justiceLabel(row.justice)}</dt>
              <dd>{row.applications} applications<small>{pct(row.referred, row.applications)} decided by the full Court · {row.granted} granted</small></dd></div>)}
          </dl>
        </section>
        <section className={styles.section} aria-labelledby="dissent-title">
          <h2 id="dissent-title">Publicly noted dissents</h2>
          {data.dissents.length ? <ul className={styles.votes}>{data.dissents.map((row) => <li key={row.justice}><strong>{justiceLabel(row.justice)}</strong> · {row.notes} noted</li>)}</ul>
            : <p className={styles.note}>No noted dissents in the applications Jurvio holds yet.</p>}
          <p className={styles.note}>These are minimums: justices often do not note how they voted on emergency applications.</p>
        </section>
        <section className={styles.section} aria-labelledby="speed-title">
          <h2 id="speed-title">How quickly Jurvio sees updates</h2>
          <p className={styles.note}>{data.speed.lines
            ? <>Across {data.speed.lines} docket updates in the last 90 days, Jurvio stored the median update {Math.round((data.speed.medianMinutesAfterDocketDay ?? 0) / 60)} hours after the start of its docket day (Eastern). The Court&apos;s docket shows dates, not times, so this overstates the real delay.</>
            : "Not enough updates yet to measure."}</p>
        </section>
        <p className={styles.note}>Counts cover the applications Jurvio holds (the 2025 and 2026 docket years so far), not the Court&apos;s full history. Routine extension requests are excluded.</p>
      </>}
    </div>
  </main>;
}
