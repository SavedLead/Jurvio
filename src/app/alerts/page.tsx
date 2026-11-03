import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { loadAccount } from "@/modules/accounts/application/account";
import { listEntityFollows } from "@/modules/accounts/application/entity-follows";
import { FREQUENCY_LABEL, KIND_EXPLAINER, matchesSinceLabel, KIND_LABEL, TIMING_NOTE } from "@/modules/accounts/domain/entity-follow";
import { formatLimit, nextPlanUp, PLANS } from "@/modules/accounts/domain/plans";
import { TOPICS } from "@/modules/accounts/domain/topics";
import { currentUser } from "@/modules/accounts/http/session";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { UnfollowButton } from "@/modules/accounts/ui/unfollow-button";
import "../account-pages.css";
import "./my-alerts.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "My alerts",
  robots: { index: false, follow: false },
};

const EVENT_LABEL: Record<string, string> = { new_case: "New case", docket_entry: "Docket", decision: "Decision" };

function targetHref(kind: string, targetKey: string): Route | null {
  if (kind === "judge") return `/judges/${targetKey}` as Route;
  if (kind === "topic") return `/topics/${targetKey}` as Route;
  return null;
}

export default async function MyAlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/signin?next=/alerts" as Route);
  const sql = db();
  const [account, follows] = await Promise.all([loadAccount(sql, user.userId), listEntityFollows(sql, user.userId)]);
  if (!account) redirect("/signin?next=/alerts" as Route);
  const params = await searchParams;
  const plan = account.planDefinition;
  const entityUpgrade = nextPlanUp(account.plan, "entityFollowLimit");
  const caseUpgrade = nextPlanUp(account.plan, "followLimit");
  const entityFull = follows.length >= plan.entityFollowLimit;

  return <main className="accountShell wide myAlerts">
    <section className="accountCard" aria-labelledby="alerts-title">
      <p className="accountEyebrow">Jurvio account</p>
      <h1 id="alerts-title">My alerts</h1>
      <p className="accountIntro">Follow judges, topics and parties to get an email when new public filings and decisions match. {TIMING_NOTE}</p>
      {params.saved ? <p className="accountNotice" role="status">Saved.</p> : null}
      {params.removed ? <p className="accountNotice" role="status">Alert removed.</p> : null}
      {params.error ? <p className="accountNotice error" role="alert">That alert could not be changed. Reload and try again.</p> : null}
      {account.alertsUnsubscribed ? <div className="accountNotice error">
        Alert emails are off for this account (unsubscribed). Matches still show on this page.
        <form action="/api/alerts/resubscribe" method="post" style={{ marginTop: 8 }}><button className="accountButton" type="submit">Resume alert emails</button></form>
      </div> : null}
      <dl className="alertsUsage">
        <div><dt>Plan</dt><dd>{plan.name}</dd></div>
        <div><dt>Judges, topics and parties</dt><dd>{follows.length} of {formatLimit(plan.entityFollowLimit)}</dd></div>
        <div><dt>Cases</dt><dd>{account.followCount} of {formatLimit(plan.followLimit)}</dd></div>
      </dl>
      {entityFull && entityUpgrade ? <p className="alertsUpgrade">
        You are using all {formatLimit(plan.entityFollowLimit)} of your judge, topic and party {plan.entityFollowLimit === 1 ? "follow" : "follows"}.
        {" "}{entityUpgrade.name} gives you {formatLimit(entityUpgrade.entityFollowLimit)}{entityUpgrade.id === "pro" ? "" : `, and ${PLANS.pro.name} is unlimited`}. Upgrades are coming soon; nothing is charged today.
        {" "}<Link href={"/pricing" as Route}>See plans</Link>
      </p> : null}
    </section>

    <section className="accountCard" aria-labelledby="entity-title">
      <h2 id="entity-title">Judges, topics and parties</h2>
      {follows.length === 0 ? <div className="alertsEmpty">
        <p>You are not following any judges, topics or parties yet.</p>
        <ul>
          <li><Link href="/judges">Judges</Link>: open a judge and choose <strong>Follow judge</strong>. {KIND_EXPLAINER.judge}</li>
          <li><Link href={"/topics" as Route}>Topics</Link>: pick a topic and choose <strong>Follow topic</strong>. {KIND_EXPLAINER.topic}</li>
          <li>Parties: on a case page, use <strong>Follow</strong> next to a party name. {KIND_EXPLAINER.party}</li>
        </ul>
      </div> : <ul className="alertsList">
        {follows.map((follow) => {
          const href = targetHref(follow.kind, follow.targetKey);
          return <li key={follow.id} className="alertsItem">
            <div className="alertsItemHead">
              <div className="alertsItemTitle">
                <span className={`alertsKind alertsKind-${follow.kind}`}>{KIND_LABEL[follow.kind]}</span>
                {href ? <Link href={href}>{follow.label}</Link> : <span>{follow.label}</span>}
              </div>
              <div className="alertsItemActions">
                <form action="/api/entity-follows" method="post" className="alertsFrequencyForm">
                  <input type="hidden" name="id" value={follow.id} />
                  <label htmlFor={`freq-${follow.id}`} className="srOnly">Email frequency for {follow.label}</label>
                  <select id={`freq-${follow.id}`} name="frequency" defaultValue={follow.frequency}>
                    <option value="daily">{FREQUENCY_LABEL.daily}</option>
                    {plan.entityAsap ? <option value="asap">{FREQUENCY_LABEL.asap}</option> : null}
                  </select>
                  <button type="submit" className="accountButton secondary">Save</button>
                </form>
                <form action="/api/entity-follows" method="post">
                  <input type="hidden" name="id" value={follow.id} />
                  <input type="hidden" name="remove" value="1" />
                  <button type="submit" className="accountButton secondary">Remove</button>
                </form>
              </div>
            </div>
            <p className="alertsMeta">
              {KIND_EXPLAINER[follow.kind]} {matchesSinceLabel(follow.matches7d, follow.createdAt)}
              {follow.queued ? ` · ${follow.queued.toLocaleString("en-US")} waiting for the next email` : ""}
              {follow.lastSentAt ? ` · last emailed ${follow.lastSentAt.slice(0, 10)}` : ""}
            </p>
            {follow.recent.length ? <ol className="alertsMatches" aria-label={`Latest matches for ${follow.label}`}>
              {follow.recent.map((item, index) => <li key={`${index}-${item.casePublicId}`}>
                <span className="alertsEvent">{EVENT_LABEL[item.eventKind] ?? "Update"}</span>
                <span>
                  <Link href={`/case/${item.casePublicId}` as Route}>{cleanCaseCaption(item.caption)}</Link>
                  <small>{[item.summary, item.courtName, item.docketNumber, item.occurredOn ? `filed ${item.occurredOn}` : null].filter(Boolean).join(" · ")}</small>
                </span>
              </li>)}
            </ol> : <p className="alertsMeta">No matches yet. New matches appear here as Jurvio finds them.</p>}
          </li>;
        })}
      </ul>}
      <p className="accountFinePrint">Alerts cover public court records only. Sealed or restricted filings are never sent, and for courts other than the Supreme Court an alert names the case and the date, never the docket text. <Link href={"/topics" as Route}>Browse {TOPICS.length} topics</Link></p>
    </section>

    <section className="accountCard" aria-labelledby="cases-title">
      <h2 id="cases-title">Followed cases</h2>
      {account.follows.length === 0
        ? <p className="accountIntro">You are not following any cases yet. Open a case and use “Follow this case”.</p>
        : <ul className="accountFollowList">
          {account.follows.map((follow) => <li key={follow.casePublicId}>
            <span>
              <Link href={`/case/${follow.casePublicId}` as Route}>{cleanCaseCaption(follow.caption)}</Link>
              <small>{[follow.courtName, follow.docketNumber, [follow.activity ? "docket activity" : null, follow.citations ? "citations" : null].filter(Boolean).join(" + ")].filter(Boolean).join(" · ")}</small>
            </span>
            <UnfollowButton caseId={follow.casePublicId} />
          </li>)}
        </ul>}
      {account.followCount >= plan.followLimit && caseUpgrade ? <p className="alertsUpgrade">
        You are following {account.followCount} of {formatLimit(plan.followLimit)} cases. {caseUpgrade.name} follows up to {formatLimit(caseUpgrade.followLimit)}: upgrade coming soon. <Link href={"/pricing" as Route}>See plans</Link>
      </p> : null}
    </section>
  </main>;
}
