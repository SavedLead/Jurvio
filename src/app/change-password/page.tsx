import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "@/app/login/login.module.css";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), ["administrator"]);
  } catch { redirect("/login"); }
  if (!principal.mustChangePassword) redirect("/");

  const { error } = await searchParams;
  const message = error === "mismatch"
    ? "The passwords do not match."
    : error === "weak"
      ? "Use at least 14 characters."
      : error === "session"
        ? "Your secure session expired. Sign in again."
        : null;

  return <main className={styles.main}>
    <section className={styles.card}>
      <div className={styles.brand} aria-hidden="true">J<span>.</span></div>
      <p className={styles.eyebrow}>First sign-in</p>
      <h1>Create your password</h1>
      <p className={styles.intro}>Replace the temporary password before entering the command center.</p>
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <form action="/api/internal-auth/change-password" method="post" className={styles.form}>
        <label>New password
          <input name="password" type="password" autoComplete="new-password" minLength={14} required autoFocus />
        </label>
        <label>Confirm new password
          <input name="confirmation" type="password" autoComplete="new-password" minLength={14} required />
        </label>
        <button type="submit">Save password</button>
      </form>
      <p className={styles.security}>Minimum 14 characters · Your temporary password will stop working</p>
    </section>
  </main>;
}
