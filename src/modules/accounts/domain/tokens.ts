import { createHash, randomBytes } from "node:crypto";

export const LOGIN_TOKEN_TTL_MINUTES = 15;
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = "jurvio_session";
/** Non-secret hint so cached pages can show "Account" instead of "Sign in" client-side. */
export const SIGNED_IN_HINT_COOKIE = "jurvio_signed_in";

/** 32 random bytes, base64url. The raw value only ever lives in the email link or cookie. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Hash for rate-limit keys and logs, so raw emails/IPs are not stored there. */
export function hashIdentifier(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/** Only same-site absolute paths; never protocol-relative, backslash or scheme URLs. */
export function safeRedirectPath(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string") return fallback;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) return fallback;
  if (path.length > 300) return fallback;
  if (path.startsWith("/api/") || path.startsWith("/signin")) return fallback;
  return path;
}

/** Case public ids look like "jv-..."; anything else is ignored as a follow intent. */
export function safeCasePublicId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[a-z0-9][a-z0-9-]{1,80}$/i.test(id) ? id : null;
}
