import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { robotsFor } from "@/lib/seo/indexing";
import { FollowEntityButton } from "@/modules/accounts/ui/follow-entity-button";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { listEmergencyApplications, statusUncertain, type ListStatus } from "@/modules/scotus/application/emergency-docket";
import {
  APPLICANT_KIND_LABEL, EMERGENCY_FEEDS, EMERGENCY_TIMING_NOTE, EVENT_LABEL, STATUS_LABEL, easternDate, responseDisplay,
  type ApplicantKind, type ApplicationKind,
} from "@/modules/scotus/domain/emergency-application";
import styles from "./emergency.module.css";
import { easternTime, justiceLabel, kindLabel, shortDate } from "./format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Supreme Court Emergency Docket: Applications, Stays and Deadlines",
  description: "Track emergency applications at the U.S. Supreme Court: stays, injunctions and stays of execution, response deadlines, administrative stays, rulings and noted dissents, explained in plain English.",
  alternates: { canonical: "/supreme-court/emergency" },
  robots: robotsFor(true),
};

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

const STATUSES: Array<{ id: ListStatus; label: string }> = [
  { id: "open", label: "Pending" }, { id: "decided", label: "Decided" }, { id: "all", label: "All" },
];
const APPLICANTS: ApplicantKind[] = ["federal", "state", "private"];
const KINDS: Array<{ id: ApplicationKind; label: string }> = [
  { id: "stay", label: "Stays" }, { id: "injunction", label: "Injunctions" }, { id: "stay_of_execution", label: "Stays of execution" },
  { id: "vacate_stay", label: "Vacate a stay" },
];

export default async function EmergencyDocketPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const status = (STATUSES.find((item) => item.id === one(params.status))?.id ?? "open") as ListStatus;
  const applicant = APPLICANTS.includes(one(params.applicant) as ApplicantKind) ? one(params.applicant) as ApplicantKind : null;
  const kind = KINDS.find((item) => item.id === one(params.kind))?.id ?? null;
  const extensions = one(params.extensions) === "1";
  const data = await listEmergencyApplications(db(), { status, applicant, kind, extensions });
  const today = easternDate(new Date());

  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | null> = { status: status === "open" ? null : status, applicant, kind, extensions: extensions ? "1" : null, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const query = next.toString();
    return (query ? `/supreme-court/emergency?${query}` : "/supreme-court/emergency") as Route;
  };
  const featuredFeeds = EMERGENCY_FEEDS.filter((feed) => !feed.slug.startsWith("justice:"));
  const justiceFeeds = EMERGENCY_FEEDS.filter((feed) => feed.slug.startsWith("justice:"));

  return <main className={styles.page}>
    <header className={`${styles.wrap} ${styles.hero}`}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Jurvio</Link><span>/</span><Link href="/supreme-court">Supreme Court</Link><span>/</span>Emergency docket
      </nav>
      <p className={styles.eyebrow}><span aria-hidden="true" /> Emergency docket</p>
      <h1>Supreme Court emergency applications, tracked and explained</h1>
      <p className={styles.lede}>Requests to pause, block or allow lower-court orders while a case goes on. See who asked, which justice has it, when a response is due, and what the Court decided, in plain English.</p>
      <div className={styles.timing}><p>{EMERGENCY_TIMING_NOTE}{data?.freshness.lastCheckedAt ? <> Last check: {easternTime(data.freshness.lastCheckedAt)}.</> : null}</p></div>
      {data ? <dl className={styles.stats}>
        <div><dt>Pending</dt><dd>{data.counts.openSerious}<small>serious applications</small></dd></div>
        <div><dt>Decided</dt><dd>{data.counts.decided30}<small>in the last 30 days</small></dd></div>
        <div><dt>Extensions</dt><dd>{data.counts.extensionsHidden}<small>routine, hidden by default</small></dd></div>
        <div><dt>Tracked</dt><dd>{data.counts.total}<small>applications held</small></dd></div>
      </dl> : null}
    </header>

    <div className={`${styles.wrap} ${styles.layout}`}>
      <section aria-labelledby="applications-title">
        <h2 id="applications-title" className="srOnly">Applications</h2>
        <div className={styles.filters}>
          <div className={styles.filterGroup} role="group" aria-label="Status">
            {STATUSES.map((item) => <Link key={item.id} href={href({ status: item.id === "open" ? null : item.id })} aria-current={item.id === status ? "true" : undefined}>{item.label}</Link>)}
          </div>
          <div className={styles.filterGroup} role="group" aria-label="Who asked">
            <Link href={href({ applicant: null })} aria-current={!applicant ? "true" : undefined}>Anyone</Link>
            {APPLICANTS.map((item) => <Link key={item} href={href({ applicant: item })} aria-current={item === applicant ? "true" : undefined}>{APPLICANT_KIND_LABEL[item]}</Link>)}
          </div>
          <div className={styles.filterGroup} role="group" aria-label="Type of request">
            <Link href={href({ kind: null })} aria-current={!kind ? "true" : undefined}>Any request</Link>
            {KINDS.map((item) => <Link key={item.id} href={href({ kind: item.id })} aria-current={item.id === kind ? "true" : undefined}>{item.label}</Link>)}
          </div>
        </div>
        <p className={styles.toggle}>
          {extensions
            ? <>Showing routine requests for more time to file. <Link href={href({ extensions: null })}>Hide extensions</Link></>
            : <>Routine requests for more time to file are hidden. <Link href={href({ extensions: "1" })}>Show extensions</Link></>}
        </p>

        {!data ? <div className={styles.empty}><h2>The emergency docket is loading</h2><p>Jurvio could not read the emergency docket just now. Try again in a minute, or use the <a href="https://www.supremecourt.gov/docket/docket.aspx">Court&apos;s docket search ↗</a>.</p></div>
          : data.rows.length === 0 ? <div className={styles.empty}><h2>No applications match</h2><p>Try another filter, or <Link href={"/supreme-court/emergency?status=all" as Route}>see every application</Link>.</p></div>
          : <ol className={styles.list}>
            {data.rows.map((row) => {
              const response = statusUncertain(row) ? null : responseDisplay(row, today);
              return <li key={row.docketNumber} className={styles.item}>
                <div><span className={styles.docket}>No. {row.docketNumber}</span></div>
                <div>
                  <h2><Link href={`/supreme-court/emergency/${row.docketNumber}` as Route}>{cleanCaseCaption(row.caption)}</Link></h2>
                  <p>
                    {row.lastEvent ? <>{EVENT_LABEL[row.lastEvent.kind]}{row.lastEvent.filedOn ? ` · ${shortDate(row.lastEvent.filedOn)}` : ""}</> : "Filed"}
                    {row.submittedJustice ? <> · to {justiceLabel(row.submittedJustice)}</> : null}
                  </p>
                  <div className={styles.meta}>
                    <span className={`${styles.chip} ${row.capital ? styles.chipCapital : row.kind === "stay" || row.kind === "injunction" ? styles.chipStay : ""}`}>{kindLabel(row.kind, row.capital)}</span>
                    <span className={styles.chip}>{APPLICANT_KIND_LABEL[row.applicantKind]}</span>
                    {row.adminStayOn && row.status === "pending" ? <span className={styles.chip}>Administrative stay</span> : null}
                    {row.notedVotes ? <span className={styles.chip}>{row.notedVotes} noted {row.notedVotes === 1 ? "vote" : "votes"}</span> : null}
                    {row.lowerCourt ? <span className={styles.chip}>{row.lowerCourt}</span> : null}
                  </div>
                </div>
                <div className={styles.side}>
                  {statusUncertain(row)
                    ? <span className={`${styles.status} ${styles.status_withdrawn}`} title="Some docket lines are withheld">Check Court docket</span>
                    : <span className={`${styles.status} ${styles[`status_${row.status}`] ?? ""}`}>{STATUS_LABEL[row.status]}</span>}
                  {response?.state === "due" ? <span className={response.days <= 2 ? styles.due : undefined}>Response due {response.days === 0 ? "today" : response.days === 1 ? "tomorrow" : `in ${response.days} days`}</span>
                    : response?.state === "filed" ? <span>Response filed {shortDate(response.on)}</span>
                    : response?.state === "passed" ? <span>Response deadline passed {shortDate(response.on)}</span> : null}
                  {row.rulingOn ? <span>Ruled {shortDate(row.rulingOn)}</span> : null}
                </div>
              </li>;
            })}
          </ol>}
      </section>

      <aside className={styles.aside} aria-label="Emergency docket alerts">
        <section className={styles.panel}>
          <h2>Get emergency docket alerts</h2>
          <p>Follow a feed and Jurvio emails you when an application in it is filed, gets a deadline or a stay, or is decided. Free includes one feed with a weekday daily email; Plus sends hourly and Pro about every 10 minutes.</p>
          <ul className={styles.feedList}>
            {featuredFeeds.map((feed) => <li key={feed.slug}>
              <strong>{feed.label}</strong>
              <small>{feed.description}</small>
              <FollowEntityButton kind="emergency" target={feed.slug} name={feed.label} compact />
            </li>)}
          </ul>
          <details className={styles.more}>
            <summary>Follow applications to one justice</summary>
            <ul className={styles.feedList} style={{ marginTop: 12 }}>
              {justiceFeeds.map((feed) => <li key={feed.slug}>
                <strong>{feed.label}</strong>
                <FollowEntityButton kind="emergency" target={feed.slug} name={feed.label} compact />
              </li>)}
            </ul>
          </details>
        </section>
        <section className={styles.panel}>
          <h2>Pro tools</h2>
          <div className={styles.proTools}>
            <Link href={"/supreme-court/emergency/analytics" as Route}>Emergency docket analytics</Link>
            <a href="/api/emergency/deadlines.ics" rel="nofollow">Response-deadline calendar (.ics)</a>
            <a href="/api/emergency/export.csv" rel="nofollow">Export applications (CSV)</a>
            <small>Included with <Link href={"/pricing" as Route}>Pro and Team</Link>. Sign in to use them.</small>
          </div>
        </section>
        <section className={styles.panel}>
          <h3>What is the emergency docket?</h3>
          <p>Each application goes first to the &ldquo;circuit justice&rdquo; for the region it came from. That justice can decide alone, ask the other side to respond, issue a short administrative stay, or refer it to all nine justices. Most rulings come as short unsigned orders.</p>
          <p>Jurvio withholds any docket line that mentions sealed or restricted material.</p>
        </section>
      </aside>
    </div>
  </main>;
}
