import type { Metadata } from "next";
import "../../account-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Finish signing in",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// The emailed link lands here. The token is only consumed when the visitor
// presses the button (POST), so link scanners cannot use it up.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="accountShell">
    <section className="accountCard" aria-labelledby="verify-title">
      <p className="accountEyebrow">Jurvio account</p>
      <h1 id="verify-title">Finish signing in</h1>
      {token ? <>
        <p className="accountIntro">Press the button to sign in on this device.</p>
        <form className="accountForm" action="/api/auth/verify" method="post">
          <input type="hidden" name="token" value={token} />
          <button className="accountButton" type="submit" autoFocus>Sign in to Jurvio</button>
        </form>
      </> : <p className="accountNotice error" role="alert">This link is incomplete. <a href="/signin">Request a new sign-in link.</a></p>}
    </section>
  </main>;
}
