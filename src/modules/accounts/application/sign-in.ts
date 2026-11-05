import type { Sql } from "postgres";
import type { EmailProvider } from "../infrastructure/email";
import { escapeHtml } from "../infrastructure/email";
import { hitRateLimit } from "./rate-limit";
import {
  LOGIN_TOKEN_TTL_MINUTES, SESSION_TTL_DAYS, generateToken, hashIdentifier, hashToken,
  normalizeEmail, safeCasePublicId, safeRedirectPath,
} from "../domain/tokens";

export type SignInRequestStatus = "sent" | "logged" | "invalid" | "rate_limited" | "unavailable";

export interface SignInRequestInput {
  email: unknown;
  ip: string;
  redirectPath?: unknown;
  followCasePublicId?: unknown;
  /** Follow kinds ticked in the signed-out Follow box: bit 1 activity, bit 2 citations. */
  followKindBits?: number;
  /** First-touch attribution + sign-in start page, carried to account creation. */
  attribution?: Record<string, unknown> | null;
}

export interface SignInDeps {
  provider: EmailProvider | null;
  siteUrl: string;
  production: boolean;
  /** Dev-only sink for the link when no provider is configured. */
  log?: (line: string) => void;
}

function followKindBits(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

export function signInLink(siteUrl: string, token: string): string {
  const url = new URL("/signin/verify", siteUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function signInEmail(link: string) {
  const subject = "Your Jurvio sign-in link";
  const text = [
    "Use this link to sign in to Jurvio. It works once and expires in 15 minutes.",
    "",
    link,
    "",
    "If you did not ask to sign in, you can ignore this email.",
  ].join("\n");
  const safe = escapeHtml(link);
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0b1730">
<p>Use this button to sign in to Jurvio. It works once and expires in 15 minutes.</p>
<p><a href="${safe}" style="display:inline-block;padding:12px 18px;border-radius:7px;background:#084cc8;color:#fff;text-decoration:none;font-weight:600">Sign in to Jurvio</a></p>
<p style="font-size:13px;color:#5b6678">Or paste this link into your browser:<br>${safe}</p>
<p style="font-size:13px;color:#5b6678">If you did not ask to sign in, you can ignore this email.</p>
</body></html>`;
  return { subject, text, html };
}

export async function requestSignIn(sql: Sql, input: SignInRequestInput, deps: SignInDeps): Promise<SignInRequestStatus> {
  const email = normalizeEmail(input.email);
  if (!email) return "invalid";
  if (!deps.provider && deps.production) return "unavailable";

  const ipAllowed = await hitRateLimit(sql, "signin_ip", input.ip || "unknown");
  const emailAllowed = await hitRateLimit(sql, "signin_email", email);
  if (!ipAllowed || !emailAllowed) return "rate_limited";

  // Opportunistic cleanup; the expires index keeps it cheap.
  await sql`DELETE FROM auth_login_token WHERE expires_at < now() - interval '1 day'`;

  const token = generateToken();
  const redirectPath = safeRedirectPath(input.redirectPath);
  const followCasePublicId = safeCasePublicId(input.followCasePublicId);
  await sql`
    INSERT INTO auth_login_token (token_hash, email, redirect_path, follow_case_public_id, follow_kinds, attribution, requested_ip_hash, expires_at)
    VALUES (${hashToken(token)}, ${email}, ${redirectPath}, ${followCasePublicId}, ${followKindBits(input.followKindBits)}, ${input.attribution ? sql.json(input.attribution as never) : null},
      ${hashIdentifier("ip", input.ip || "unknown")}, now() + make_interval(mins => ${LOGIN_TOKEN_TTL_MINUTES}))`;
  const link = signInLink(deps.siteUrl, token);

  if (!deps.provider) {
    (deps.log ?? console.log)(`[dev] Jurvio sign-in link for ${email}: ${link}`);
    return "logged";
  }

  const message = signInEmail(link);
  const result = await deps.provider.send({ to: email, ...message, tag: "signin_link" });
  const [user] = await sql<{ id: string }[]>`SELECT id FROM app_user WHERE email = ${email}`;
  await sql`
    INSERT INTO email_event (user_id, email_hash, kind, provider, status, provider_message_id, detail)
    VALUES (${user?.id ?? null}, ${user ? null : hashIdentifier("email", email)}, 'signin_link', ${deps.provider.name},
      ${result.ok ? "sent" : "failed"}, ${result.providerMessageId ?? null}, ${sql.json(result.error ? { error: result.error } : {})})`;
  return result.ok ? "sent" : "unavailable";
}

export interface VerifiedSignIn {
  userId: string;
  email: string;
  sessionToken: string;
  redirectPath: string;
  followCasePublicId: string | null;
  followKindBits?: number;
  /** True only when this sign-in created the account (first sign-in for the address). */
  created?: boolean;
}

/** Consumes a magic-link token (single use, unexpired) and opens a session. */
export async function verifySignIn(sql: Sql, token: unknown): Promise<VerifiedSignIn | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  return sql.begin(async (tx) => {
    const [login] = await tx<{ email: string; redirectPath: string | null; followCasePublicId: string | null; followKindBits: number; attribution: Record<string, unknown> | null }[]>`
      UPDATE auth_login_token SET consumed_at = now()
      WHERE token_hash = ${hashToken(token)} AND consumed_at IS NULL AND expires_at > now()
      RETURNING email, redirect_path AS "redirectPath", follow_case_public_id AS "followCasePublicId", follow_kinds AS "followKindBits", attribution`;
    if (!login) return null;
    const [user] = await tx<{ id: string; created: boolean }[]>`
      INSERT INTO app_user (email, email_verified_at, last_signed_in_at) VALUES (${login.email}, now(), now())
      ON CONFLICT (email) DO UPDATE SET
        email_verified_at = COALESCE(app_user.email_verified_at, now()), last_signed_in_at = now(), updated_at = now()
      RETURNING id, (xmax = 0) AS created`;
    await tx`INSERT INTO account_subscription (user_id) VALUES (${user!.id}) ON CONFLICT (user_id) DO NOTHING`;
    await recordSignupAttribution(tx as unknown as Sql, user!.id, login.attribution);
    const sessionToken = generateToken();
    await tx`
      INSERT INTO auth_session (token_hash, user_id, expires_at)
      VALUES (${hashToken(sessionToken)}, ${user!.id}, now() + make_interval(days => ${SESSION_TTL_DAYS}))`;
    return {
      userId: user!.id,
      email: login.email,
      sessionToken,
      redirectPath: safeRedirectPath(login.redirectPath),
      followCasePublicId: login.followCasePublicId,
      followKindBits: followKindBits(login.followKindBits),
      created: Boolean(user!.created),
    };
  });
}

export interface SessionUser {
  userId: string;
  email: string;
}

export async function getSessionUser(sql: Sql, sessionToken: string | null | undefined): Promise<SessionUser | null> {
  if (!sessionToken || sessionToken.length < 20 || sessionToken.length > 200) return null;
  const [row] = await sql<SessionUser[]>`
    SELECT u.id AS "userId", u.email
    FROM auth_session s JOIN app_user u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(sessionToken)} AND s.revoked_at IS NULL AND s.expires_at > now()`;
  return row ?? null;
}

export async function revokeSession(sql: Sql, sessionToken: string | null | undefined): Promise<void> {
  if (!sessionToken || sessionToken.length > 200) return;
  await sql`UPDATE auth_session SET revoked_at = now() WHERE token_hash = ${hashToken(sessionToken)} AND revoked_at IS NULL`;
}

/** Saves first-touch attribution on the account once (first sign-in wins). */
export async function recordSignupAttribution(sql: Sql, userId: string, a: Record<string, unknown> | null): Promise<void> {
  const str = (k: string) => (a && typeof a[k] === "string" ? (a[k] as string).slice(0, 300) : null);
  await sql`
    INSERT INTO signup_attribution (user_id, source, referrer_host, landing_path, utm_source, utm_medium, utm_campaign, first_touch_at, signin_from_path)
    VALUES (${userId}, ${str("source") ?? "unknown"}, ${str("referrerHost")}, ${str("landingPath")}, ${str("utmSource")}, ${str("utmMedium")},
      ${str("utmCampaign")}, ${str("at")}::timestamptz, ${str("signinFromPath")})
    ON CONFLICT (user_id) DO NOTHING`;
}
