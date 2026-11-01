import type { Metadata } from "next";
import "../../account-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe from alerts", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;
  return <main className="accountShell">
    <section className="accountCard" aria-labelledby="unsubscribe-title">
      <p className="accountEyebrow">Jurvio alerts</p>
      <h1 id="unsubscribe-title">{done ? "You are unsubscribed" : "Unsubscribe from alerts"}</h1>
      {done ? <p className="accountIntro">You will not get docket alert emails from Jurvio. Your follows are kept; you can resume alerts from your account page.</p>
        : token ? <>
          <p className="accountIntro">Stop all docket alert emails for this address? Sign-in links still work.</p>
          <form className="accountForm" action="/api/alerts/unsubscribe" method="post">
            <input type="hidden" name="token" value={token} />
            <button className="accountButton" type="submit">Unsubscribe</button>
          </form>
        </> : <p className="accountNotice error" role="alert">This unsubscribe link is incomplete.</p>}
    </section>
  </main>;
}
