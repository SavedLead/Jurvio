/** First-touch attribution shared by the browser beacon, the API routes and the Growth page. */
export const FIRST_TOUCH_COOKIE = "jv_ft";
export const LAST_PUBLIC_PATH_COOKIE = "jv_lp";

export interface FirstTouch {
  source: string;
  referrerHost: string | null;
  landingPath: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  at: string | null;
}

/** Paths where attribution is never captured (auth, account, private and API routes). */
export function isTrackablePublicPath(path: string): boolean {
  return !/^\/(?:api|internal|account|signin|login|change-password|alerts|preview|heartbeat|in)(?:\/|$)/.test(path);
}

const clip = (v: unknown, n: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, n);
  return t ? t : null;
};

export function normalizeHost(value: unknown): string | null {
  const v = clip(value, 255);
  if (!v) return null;
  try {
    const host = (v.includes("://") ? new URL(v).hostname : v).toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch { return null; }
}

/** Google, Bing, X, direct, or the referrer/utm host as "other:<host>"-style buckets. */
export function classifySource(referrerHost: string | null, utmSource: string | null, ownHosts: readonly string[] = ["jurvio.com", "z.jurvio.com"]): string {
  const h = referrerHost && !ownHosts.includes(referrerHost) ? referrerHost : null;
  const probe = h ?? (utmSource ? utmSource.toLowerCase() : null);
  if (!probe) return "direct";
  if (/(^|\.)google\.|^google$/.test(probe)) return "google";
  if (/(^|\.)bing\.com$|^bing$/.test(probe)) return "bing";
  if (/(^|\.)(x\.com|twitter\.com|t\.co)$|^(x|twitter)$/.test(probe)) return "x";
  return "other";
}

export function cleanPath(value: unknown): string {
  const v = clip(value, 300) ?? "/";
  const p = v.split(/[?#]/, 1)[0] || "/";
  return p.startsWith("/") ? p : "/";
}

export function parseFirstTouch(raw: unknown): FirstTouch | null {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw) {
    try { obj = JSON.parse(raw.startsWith("%") ? decodeURIComponent(raw) : raw); } catch {
      try { obj = JSON.parse(decodeURIComponent(raw)); } catch { return null; }
    }
  } else if (raw && typeof raw === "object") obj = raw as Record<string, unknown>;
  if (!obj) return null;
  const referrerHost = normalizeHost(obj.r);
  const utmSource = clip(obj.us, 100);
  const at = typeof obj.t === "number" && Number.isFinite(obj.t) ? new Date(obj.t).toISOString() : null;
  return {
    source: classifySource(referrerHost, utmSource),
    referrerHost,
    landingPath: cleanPath(obj.l),
    utmSource,
    utmMedium: clip(obj.um, 100),
    utmCampaign: clip(obj.uc, 100),
    at,
  };
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

/** Attribution JSON stored on auth_login_token / lead_waitlist. */
export function attributionFromCookies(cookieHeader: string | null | undefined): Record<string, unknown> | null {
  const ft = parseFirstTouch(readCookie(cookieHeader, FIRST_TOUCH_COOKIE));
  const lp = readCookie(cookieHeader, LAST_PUBLIC_PATH_COOKIE);
  const from = lp ? cleanPath(decodeURIComponent(lp)) : null;
  if (!ft && !from) return null;
  return { ...(ft ?? {}), signinFromPath: from };
}
