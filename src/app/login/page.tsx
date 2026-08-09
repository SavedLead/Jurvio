import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  try {
    const principal = await requireInternalPrincipal(db(), await headers(), ["administrator"]);
    redirect(principal.mustChangePassword ? "/change-password" : "/");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
  }

  const { error } = await searchParams;
  const message = error === "locked"
    ? "Too many attempts. Wait 15 minutes and try again."
    : error === "invalid"
      ? "The email or password is incorrect."
      : null;

  return <main className={styles.main}>
    <section className={styles.card}>
      <div className={styles.brand} aria-hidden="true">J<span>.</span></div>
      <p className={styles.eyebrow}>Private command center</p>
      <h1>Sign in</h1>
      <p className={styles.intro}>Use your authorized Jurvio administrator account.</p>
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <form action="/api/internal-auth/login" method="post" className={styles.form}>
        <label>Email
          <input name="email" type="email" autoComplete="username" required autoFocus
            placeholder="name@jurvio.com" />
        </label>
        <label>Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Continue</button>
      </form>
      <p className={styles.security}>Private system · Authorized access only</p>
    </section>
  </main>;
}
