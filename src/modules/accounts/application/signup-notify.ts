import type { Sql } from "postgres";
import { formatEasternDateTime } from "@/lib/time/eastern";
import type { EmailProvider } from "../infrastructure/email";
import { escapeHtml } from "../infrastructure/email";

// Owner notification for each new account (and paid-plan starts/upgrades).
// Fire-and-forget: every entry point here swallows and logs its own errors so
// a sign-up never fails because the notification did. One email per account:
// the trigger runs only when verifySignIn inserted the app_user row (xmax = 0),
// and the send is claimed first via app_user.signup_notified_at (0200), which
// the one-off backfill (scripts/notify-existing-signups.ts) honours too.
// The owner email carries the full sign-up address (owner request, Nov 4 2026);
// logs never do (only kind and error).

export const DEFAULT_SIGNUP_NOTIFY_TO = "research@jurvio.com";
export const GROWTH_URL = "https://z.jurvio.com/signups";

/** SIGNUP_NOTIFY_TO overrides the recipient; "off"/"none"/"false" disables. */
export function signupNotifyRecipient(source: Record<string, string | undefined> = process.env): string | null {
  const v = source.SIGNUP_NOTIFY_TO?.trim();
  if (!v) return DEFAULT_SIGNUP_NOTIFY_TO;
  if (/^(off|none|false|0)$/i.test(v)) return null;
  return v;
}

/** "jane.doe@gmail.com" -> "j•••e@gmail.com"; short locals keep only the first character. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const masked = local.length <= 3 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

export function formatEt(date: Date): string {
  return formatEasternDateTime(date);
}

export interface SignupDetails {
  email: string;
  createdAt: Date;
  plan: string;
  status: string | null;
  attribution: {
    source: string | null; referrerHost: string | null; landingPath: string | null;
    utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
    firstTouchAt: Date | null; signinFromPath: string | null;
  } | null;
  follows: string[];
}

export type SignupEventKind = "signup" | "plan_change";

export function signupNotificationEmail(d: SignupDetails, kind: SignupEventKind = "signup", previousPlan: string | null = null) {
  const subject = kind === "signup"
    ? `New Jurvio sign-up: ${d.email} (${d.plan})`
    : `Jurvio plan change: ${d.email} ${previousPlan ?? "free"} → ${d.plan}`;
  const a = d.attribution;
  const utm = a && (a.utmSource || a.utmMedium || a.utmCampaign)
    ? [a.utmSource, a.utmMedium, a.utmCampaign].map((v) => v ?? "-").join(" / ") : "none";
  const rows: Array<[string, string]> = [
    ["Account", d.email],
    [kind === "signup" ? "Signed up" : "Account created", formatEt(d.createdAt)],
    ...(kind === "plan_change" ? [["Plan changed", formatEt(new Date())] as [string, string]] : []),
    ["Tier", d.status && d.status !== "active" ? `${d.plan} (${d.status})` : d.plan],
    ["Source", a?.source ?? "unknown"],
    ["Referrer", a?.referrerHost ?? "none/direct"],
    ["Landing page", a?.landingPath ?? "unknown"],
    ["UTM (source / medium / campaign)", utm],
    ["First touch", a?.firstTouchAt ? formatEt(a.firstTouchAt) : "unknown"],
    ["Signed in from", a?.signinFromPath ?? "unknown"],
    ["Initial follows", d.follows.length ? d.follows.join("; ") : "none"],
  ];
  const text = [...rows.map(([k, v]) => `${k}: ${v}`), "", `Growth: ${GROWTH_URL}`].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0b1730">
<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) =>
    `<tr><td style="padding:3px 12px 3px 0;color:#5b6678">${escapeHtml(k)}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`).join("")}</table>
<p><a href="${GROWTH_URL}">Open the Growth page</a></p>
</body></html>`;
  return { subject, text, html };
}

export async function loadSignupDetails(sql: Sql, userId: string): Promise<SignupDetails | null> {
  const [u] = await sql<{ email: string; createdAt: Date; plan: string | null; status: string | null }[]>`
    SELECT u.email, u.created_at AS "createdAt", s.plan::text AS plan, s.status
    FROM app_user u LEFT JOIN account_subscription s ON s.user_id = u.id WHERE u.id = ${userId}`;
  if (!u) return null;
  const [a] = await sql<NonNullable<SignupDetails["attribution"]>[]>`
    SELECT source, referrer_host AS "referrerHost", landing_path AS "landingPath", utm_source AS "utmSource",
      utm_medium AS "utmMedium", utm_campaign AS "utmCampaign", first_touch_at AS "firstTouchAt", signin_from_path AS "signinFromPath"
    FROM signup_attribution WHERE user_id = ${userId}`;
  const follows = await sql<{ label: string }[]>`
    SELECT label FROM (
      SELECT 'case ' || c.public_id || coalesce(': ' || left(c.caption, 80), '') AS label, f.created_at
        FROM case_follow f JOIN legal_case c ON c.id = f.case_id WHERE f.user_id = ${userId}
      UNION ALL
      SELECT e.kind || ': ' || left(e.label, 80), e.created_at FROM entity_follow e WHERE e.user_id = ${userId}
    ) x ORDER BY created_at LIMIT 10`;
  return { email: u.email, createdAt: new Date(u.createdAt), plan: u.plan ?? "free", status: u.status, attribution: a ?? null, follows: follows.map((f) => f.label) };
}

export interface SignupNotifyDeps {
  provider: EmailProvider | null;
  to?: string | null;
  log?: (line: string) => void;
}

/** Never throws. Returns whether an email was accepted by the provider. */
export async function notifySignupEvent(sql: Sql, userId: string, deps: SignupNotifyDeps, kind: SignupEventKind = "signup", previousPlan: string | null = null): Promise<boolean> {
  const log = deps.log ?? ((line: string) => console.error(line));
  try {
    const to = deps.to === undefined ? signupNotifyRecipient() : deps.to;
    if (!to || !deps.provider) return false;
    if (kind === "signup") {
      const [claimed] = await sql<{ id: string }[]>`
        UPDATE app_user SET signup_notified_at = now() WHERE id = ${userId} AND signup_notified_at IS NULL RETURNING id`;
      if (!claimed) return false;
    }
    const details = await loadSignupDetails(sql, userId);
    if (!details) return false;
    const message = signupNotificationEmail(details, kind, previousPlan);
    const result = await deps.provider.send({
      to, ...message, tag: kind === "signup" ? "signup_notify" : "plan_notify",
      headers: { "X-Entity-Ref-ID": `${kind}-${userId}${kind === "plan_change" ? `-${details.plan}` : ""}` },
    });
    if (!result.ok) log(JSON.stringify({ signupNotify: "send_failed", kind, error: result.error }));
    return result.ok;
  } catch (error) {
    log(JSON.stringify({ signupNotify: "failed", kind, error: error instanceof Error ? error.message.slice(0, 200) : "error" }));
    return false;
  }
}
