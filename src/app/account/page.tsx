import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { loadAccount } from "@/modules/accounts/application/account";
import { formatMonthlyPrice } from "@/modules/accounts/domain/plans";
import { currentUser } from "@/modules/accounts/http/session";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { UnfollowButton } from "@/modules/accounts/ui/unfollow-button";
import "../account-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const CADENCE_LABEL = { daily: "Daily digest", hourly: "Hourly alerts", instant: "Instant alerts" } as const;

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?next=/account" as Route);
  const account = await loadAccount(db(), user.userId);
  if (!account) redirect("/signin?next=/account" as Route);
  const plan = account.planDefinition;

  return <main className="accountShell">
    <section className="accountCard" aria-labelledby="account-title">
      <p className="accountEyebrow">Jurvio account</p>
      <h1 id="account-title">Your account</h1>
      <dl className="accountMeta">
        <dt>Email</dt><dd>{account.email}</dd>
        <dt>Plan</dt><dd>{plan.name} ({formatMonthlyPrice(plan)})</dd>
        <dt>Alerts</dt><dd>{account.alertsUnsubscribed ? "Unsubscribed" : CADENCE_LABEL[plan.alertCadence]}</dd>
        <dt>Follows</dt><dd>{account.followCount} of {plan.followLimit}</dd>
      </dl>
      {account.alertsUnsubscribed ? <form action="/api/alerts/resubscribe" method="post" style={{ marginBottom: 12 }}>
        <button className="accountButton" type="submit">Resume alert emails</button>
      </form> : null}
      <form action="/api/auth/signout" method="post">
        <button className="accountButton secondary" type="submit">Sign out</button>
      </form>
    </section>
    <section className="accountCard" aria-labelledby="follows-title">
      <h2 id="follows-title">Followed cases</h2>
      {account.follows.length === 0
        ? <p className="accountIntro">You are not following any cases yet. Open a case and use “Follow this case”.</p>
        : <ul className="accountFollowList">
          {account.follows.map((follow) => <li key={follow.casePublicId}>
            <span>
              <Link href={`/case/${follow.casePublicId}` as Route}>{cleanCaseCaption(follow.caption)}</Link>
              <small>{[follow.courtName, follow.docketNumber].filter(Boolean).join(" · ")}</small>
            </span>
            <UnfollowButton caseId={follow.casePublicId} />
          </li>)}
        </ul>}
    </section>
  </main>;
}
