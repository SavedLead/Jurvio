import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/modules/accounts/http/session";
import { signInAvailable } from "@/modules/accounts/http/config";
import { safeCasePublicId, safeRedirectPath } from "@/modules/accounts/domain/tokens";
import { EmailCaptureForm, WAITLIST_SUCCESS } from "@/modules/accounts/ui/email-capture-form";
import "../account-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Jurvio with a one-time email link.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/signin" },
};

const ERRORS: Record<string, string> = {
  invalid: "Enter a valid email address.",
  rate_limited: "Too many sign-in requests. Wait a few minutes and try again.",
  unavailable: "We could not save that just now. Please try again in a minute.",
  expired: "That sign-in link has expired or was already used. Request a new one below.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const follow = safeCasePublicId(params.follow);
  if (await currentUser()) redirect(next as Route);
  const available = signInAvailable();
  const error = params.error ? ERRORS[params.error] ?? null : null;

  return <main className="accountShell">
    <section className="accountCard" aria-labelledby="signin-title">
      <p className="accountEyebrow">Jurvio account</p>
      <h1 id="signin-title">{params.sent ? "Check your email" : params.waitlisted ? "You're on the list" : available ? "Sign in" : "Get case alerts by email"}</h1>
      {params.sent ? <>
        <p className="accountIntro">If that address can receive mail, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
        <p className="accountFinePrint">Nothing arrived? Check spam, or <Link href={`/signin${follow ? `?follow=${follow}` : ""}` as Route}>send another link</Link>.</p>
      </> : params.waitlisted ? <>
        <p className="emailCaptureDone" role="status">{WAITLIST_SUCCESS}</p>
        <p className="accountFinePrint">{follow
          ? <>We saved your request to follow this case. <Link href={`/case/${follow}` as Route}>Back to the case</Link>.</>
          : <>Every case page stays free to read. <Link href="/cases">Find a case</Link> or <Link href="/pricing">see plans</Link>.</>}</p>
      </> : !available ? <>
        <p className="accountIntro">Jurvio accounts and email alerts open soon. Leave your email and we&apos;ll tell you the moment they go live{follow ? ", and this case will already be on your follow list" : ""}. Every case page stays free to read in the meantime.</p>
        {error ? <p className="accountNotice error" role="alert">{error}</p> : null}
        <EmailCaptureForm action="/api/auth/request" hidden={follow ? { next, follow } : { next }} buttonLabel="Notify me when alerts go live"
          footnote={<>One email when accounts open, then only what you sign up for. See <Link href="/privacy">Privacy</Link>.</>} />
        <p className="accountFinePrint"><Link href="/cases">Browse cases</Link> · <Link href="/pricing">See plans</Link></p>
      </> : <>
        <p className="accountIntro">{follow
          ? "Enter your email and we will send a one-time link. The case is followed as soon as you open it."
          : "No password needed. Enter your email and we will send a one-time sign-in link."}</p>
        {error ? <p className="accountNotice error" role="alert">{error}</p> : null}
        <form className="accountForm" action="/api/auth/request" method="post">
          <label>Email
            <input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" />
          </label>
          <input type="hidden" name="next" value={next} />
          {follow ? <input type="hidden" name="follow" value={follow} /> : null}
          <button className="accountButton" type="submit">Email me a sign-in link</button>
        </form>
        <p className="accountFinePrint">New here? The same link creates your free account. See <Link href="/privacy">Privacy</Link> and <Link href="/terms">Terms</Link>.</p>
      </>}
    </section>
  </main>;
}
