import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { robotsFor } from "@/lib/seo/indexing";
import { FollowCaseBox } from "@/modules/accounts/ui/follow-case-box";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { getEmergencyApplication, statusUncertain } from "@/modules/scotus/application/emergency-docket";
import { ALLOTMENT_SOURCE_URL } from "@/modules/scotus/domain/circuit-justice";
import {
  APPLICANT_KIND_LABEL, EMERGENCY_TIMING_NOTE, EVENT_LABEL, STATUS_LABEL, easternDate, expectedJusticeFor,
  justiceSlugForRef, plainEnglishFor, responseDisplay, type ApplicationEventKind, type NotedVote,
} from "@/modules/scotus/domain/emergency-application";
import styles from "../emergency.module.css";
import { easternTime, justiceLabel, kindLabel, shortDate } from "../format";

export const dynamic = "force-dynamic";

type Params = Promise<{ docket: string }>;

function normalize(raw: string): string | null {
  const match = /^(\d{2})a(\d{1,4})$/i.exec(decodeURIComponent(raw).trim());
  return match ? `${match[1]}A${Number(match[2])}` : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const docket = normalize((await params).docket);
  const application = docket ? await getEmergencyApplication(db(), docket) : null;
  if (!application) return { title: "Emergency application not found", robots: robotsFor(false) };
  const caption = cleanCaseCaption(application.caption);
  return {
    title: `${caption} (No. ${application.docketNumber}): Supreme Court emergency application`,
    description: `${kindLabel(application.kind, application.capital)} application No. ${application.docketNumber}, ${STATUS_LABEL[application.status].toLowerCase()}. Timeline, response deadline, circuit justice and plain-English explanation.`,
    alternates: { canonical: `/supreme-court/emergency/${application.docketNumber}` },
    // Routine extension requests are thin pages: kept out of search.
    robots: robotsFor(application.kind !== "extension"),
  };
}

const KEY_EVENTS: ReadonlySet<ApplicationEventKind> = new Set([
  "submitted", "referred", "response_requested", "administrative_stay", "granted", "granted_in_part", "denied", "withdrawn", "moot", "converted",
]);

const CIRCUIT_NAME: Record<string, string> = {
  ca1: "First", ca2: "Second", ca3: "Third", ca4: "Fourth", ca5: "Fifth", ca6: "Sixth", ca7: "Seventh", ca8: "Eighth",
  ca9: "Ninth", ca10: "Tenth", ca11: "Eleventh", cadc: "D.C.", cafc: "Federal",
};

const VOTE_LABEL: Record<NotedVote["position"], string> = {
  would_grant: "would grant", would_deny: "would deny", dissent: "dissents", concurrence: "concurs", statement: "statement", recused: "took no part",
};

function headline(status: string, kind: string): string {
  if (status === "pending") return kind === "extension" ? "A routine request for more time is pending." : "This emergency request is waiting for a decision.";
  return "";
}

export default async function EmergencyApplicationPage({ params }: { params: Params }) {
  const raw = (await params).docket;
  const docket = normalize(raw);
  if (!docket) notFound();
  const app = await getEmergencyApplication(db(), docket);
  if (!app) notFound();
  const caption = cleanCaseCaption(app.caption);
  const today = easternDate(new Date());
  const expected = expectedJusticeFor(app.lowerCourt);
  const submittedSlug = justiceSlugForRef(app.submittedJustice);
  const latest = app.events.at(-1) ?? null;
  // The newest line explains where things stand, unless it is a letter, an amicus brief or something unclassified.
  const latestKey = latest && !["letter", "amicus_filed", "other"].includes(latest.kind) ? latest
    : [...app.events].reverse().find((event) => KEY_EVENTS.has(event.kind)) ?? latest;
  const uncertain = statusUncertain(app);
  const response = uncertain ? null : responseDisplay(app, today);
  const plain = uncertain
    ? "Jurvio cannot show this application's full record: some docket lines mention sealed or restricted material and are withheld, and one of them may be a ruling. Check the Court's own docket for the current status."
    : [
    headline(app.status, app.kind),
    latestKey ? plainEnglishFor(latestKey.kind, app.kind) : null,
  ].filter(Boolean).join(" ");

  return <main className={styles.page}>
    <header className={`${styles.wrap} ${styles.hero}`}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Jurvio</Link><span>/</span><Link href="/supreme-court">Supreme Court</Link><span>/</span>
        <Link href={"/supreme-court/emergency" as Route}>Emergency docket</Link><span>/</span>No. {app.docketNumber}
      </nav>
      <div className={styles.detailHead}>
        <span className={styles.docket}>No. {app.docketNumber}</span>
        {uncertain ? <span className={`${styles.status} ${styles.status_withdrawn}`}>Check Court docket</span>
          : <span className={`${styles.status} ${styles[`status_${app.status}`] ?? ""}`}>{STATUS_LABEL[app.status]}</span>}
        <span className={`${styles.chip} ${app.capital ? styles.chipCapital : ""}`}>{kindLabel(app.kind, app.capital)}</span>
        <span className={styles.chip}>{APPLICANT_KIND_LABEL[app.applicantKind]}</span>
      </div>
      <h1 style={{ fontSize: "clamp(30px,4.6vw,50px)" }}>{caption}</h1>
      {app.jurvioCase?.followable ? <a className={styles.jump} href="#follow">Follow this application ↓</a> : null}
      {app.applicant ? <p className={styles.lede}>Application by {app.applicant}{app.lowerCourt ? <>, from the {app.lowerCourt}</> : null}.</p> : null}
    </header>

    <div className={`${styles.wrap} ${styles.detailGrid}`}>
      <article>
        <section className={styles.plain} aria-labelledby="plain-title">
          <h2 id="plain-title">In plain English</h2>
          <p>{plain || "The Court has docketed this application."}</p>
        </section>

        <dl className={styles.facts}>
          <div><dt>Status</dt><dd>{uncertain ? <>Not clear<small>Some lines are withheld; see the <a href={app.sourceUrl}>Court&apos;s docket ↗</a></small></> : STATUS_LABEL[app.status]}{app.rulingOn ? <small>{shortDate(app.rulingOn)}{app.ruledBy === "court" ? " · by the full Court" : app.ruledBy === "justice" ? " · by one justice" : ""}{app.writtenReasons ? " · with a written opinion" : ""}</small> : null}</dd></div>
          <div><dt>Response deadline</dt><dd>{app.responseDueOn
            ? <>{shortDate(app.responseDueOn)}{app.responseDueText && /[ap]\.?\s?m/i.test(app.responseDueText) ? <small>{app.responseDueText}</small> : null}
              {response?.state === "due" ? <small className={response.days <= 2 ? styles.due : undefined}>{response.days === 0 ? "Due today" : response.days === 1 ? "Due tomorrow" : `In ${response.days} days`}</small>
                : response?.state === "filed" ? <small>Response filed {shortDate(response.on)}</small>
                : response?.state === "passed" ? <small>Deadline passed; no response on the public docket yet</small>
                : app.responseFiledOn ? <small>Response filed {shortDate(app.responseFiledOn)}</small> : null}
              {app.responseRequestedBy ? <small>Requested by {justiceLabel(app.responseRequestedBy)}</small> : null}</>
            : <>None set<small>A justice has not asked for a response on the public docket.</small></>}</dd></div>
          <div><dt>Submitted to</dt><dd>{app.submittedJustice
            ? (submittedSlug ? <Link href={`/justices/${submittedSlug}` as Route}>{justiceLabel(app.submittedJustice)}</Link> : justiceLabel(app.submittedJustice))
            : "Not stated"}
            {expected ? <small>{expected.justiceRef === app.submittedJustice || !app.submittedJustice
              ? <>Circuit justice for the {CIRCUIT_NAME[expected.circuit]} Circuit (<a href={ALLOTMENT_SOURCE_URL}>allotment ↗</a>)</>
              : <>The usual circuit justice would be {justiceLabel(expected.justiceRef)}.</>}</small> : null}
            {app.referredOn ? <small>Referred to the full Court {shortDate(app.referredOn)}</small> : null}</dd></div>
          <div><dt>Administrative stay</dt><dd>{app.adminStayOn
            ? <>Entered {shortDate(app.adminStayOn)}{app.adminStayJustice ? <small>by {justiceLabel(app.adminStayJustice)}</small> : null}<small>A temporary pause while the justices decide; it does not signal the outcome.</small></>
            : "None on the docket"}</dd></div>
          <div><dt>Filed</dt><dd>{app.submittedOn ? shortDate(app.submittedOn) : "Not stated"}{app.docketedOn && app.docketedOn !== app.submittedOn ? <small>Docketed {shortDate(app.docketedOn)}</small> : null}</dd></div>
          <div><dt>Lower court</dt><dd>{app.lowerCourt ?? "Not stated"}
            {app.lowerCaseNumbers.length ? <small>No. {app.lowerCaseNumbers.join(", ")}</small> : null}
            {app.linkedLowerCase ? <small><Link href={`/case/${app.linkedLowerCase.publicId}` as Route}>Open the lower-court case on Jurvio →</Link></small> : null}</dd></div>
          {app.administration && app.applicantKind === "federal" ? <div><dt>Administration</dt><dd>{app.administration}</dd></div> : null}
          {app.amicusCount ? <div><dt>Amicus briefs</dt><dd>{app.amicusCount}</dd></div> : null}
        </dl>

        {app.votes.length ? <section className={styles.section} aria-labelledby="votes-title">
          <h2 id="votes-title">Noted votes</h2>
          <ul className={styles.votes}>{app.votes.map((vote, index) => <li key={index}><strong>{justiceLabel(vote.justiceRef)}</strong> {VOTE_LABEL[vote.position]}</li>)}</ul>
          <p className={styles.note}>Only votes the Court made public are shown. On the emergency docket, justices often do not note how they voted, so an unlisted justice may still have disagreed.</p>
        </section> : app.status !== "pending" && app.kind !== "extension" ? <section className={styles.section} aria-labelledby="votes-title">
          <h2 id="votes-title">Noted votes</h2>
          <p className={styles.note}>The order does not note any justice&apos;s vote. That does not mean the decision was unanimous.</p>
        </section> : null}

        <section className={styles.section} aria-labelledby="timeline-title">
          <h2 id="timeline-title">Docket timeline</h2>
          <ol className={styles.timeline}>
            {app.events.map((event) => <li key={event.sourceRecordId} className={KEY_EVENTS.has(event.kind) ? "key" : undefined}>
              <time dateTime={event.filedOn ?? undefined}>{event.filedOn ? shortDate(event.filedOn) : "Date not stated"}</time>
              <strong>{EVENT_LABEL[event.kind]}</strong>
              <p>{event.plain}</p>
              <blockquote>{event.description}</blockquote>
            </li>)}
          </ol>
          {app.withheldLines ? <p className={styles.note}>{app.withheldLines} docket {app.withheldLines === 1 ? "line is" : "lines are"} not shown because {app.withheldLines === 1 ? "it mentions" : "they mention"} sealed or restricted material. See the Court&apos;s docket for the full record.</p> : null}
        </section>
      </article>

      <aside className={styles.aside} aria-label="Follow and sources">
        {app.jurvioCase?.followable ? <FollowCaseBox caseId={app.jurvioCase.publicId} application={{ docketNumber: app.docketNumber }} />
          : <section className={styles.panel}><h2>Follow this application</h2><p>Following is not available for this application.</p></section>}
        <section className={styles.panel}>
          <h3>How fast are updates?</h3>
          <p>{EMERGENCY_TIMING_NOTE}</p>
          {app.checkedAt ? <p>Jurvio last checked this docket {easternTime(app.checkedAt)}.</p> : null}
        </section>
        <section className={styles.panel}>
          <h3>Sources</h3>
          <ul className={styles.sourceLinks}>
            <li><a href={app.sourceUrl}>Official Supreme Court docket ↗</a></li>
            {app.linkedMerits ? <li><Link href={`/case/${app.linkedMerits.publicId}` as Route}>Related Supreme Court case No. {app.linkedMerits.docketNumber}</Link></li>
              : app.linkedDocket ? <li>Linked with No. {app.linkedDocket}</li> : null}
            {app.linkedLowerCase ? <li><Link href={`/case/${app.linkedLowerCase.publicId}` as Route}>Lower-court case: {cleanCaseCaption(app.linkedLowerCase.caption)}</Link></li> : null}
            <li><Link href={"/supreme-court/emergency" as Route}>All emergency applications</Link></li>
          </ul>
        </section>
      </aside>
    </div>
  </main>;
}
