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
    await requireInternalPrincipal(db(), await headers(), ["administrator"]);
    redirect("/");
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
      <div className={styles.brand}>J<span>.</span></div>
      <p className={styles.eyebrow}>Private command center</p>
      <h1>Sign in to Jurvio</h1>
      <p className={styles.intro}>Authorized administrators only.</p>
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <form action="/api/internal-auth/login" method="post" className={styles.form}>
        <label>Email address
          <input name="email" type="email" autoComplete="username" required
            defaultValue="david@cleanyourname.com" />
        </label>
        <label>Password
          <input name="password" type="password" autoComplete="current-password" required autoFocus />
        </label>
        <button type="submit">Sign in</button>
      </form>
      <p className={styles.security}>Secure session · Expires after 12 hours</p>
    </section>
  </main>;
}
