import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type postgres from "postgres";
import { env } from "@/lib/config/env";

type Sql = ReturnType<typeof postgres>;
export type InternalRole = "viewer" | "reviewer" | "administrator";

export interface InternalPrincipal {
  id: string;
  email: string;
  displayName: string | null;
  role: InternalRole;
}

export const INTERNAL_SESSION_COOKIE = "jurvio_admin_session";
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function cookieValue(requestHeaders: Headers, name: string) {
  const cookie = requestHeaders.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function cloudflareEmail(requestHeaders: Headers): Promise<string | null> {
  const token = requestHeaders.get("cf-access-jwt-assertion");
  if (!token) return null;

  const config = env();
  if (!config.CF_ACCESS_TEAM_DOMAIN || !config.CF_ACCESS_AUDIENCE) return null;
  const issuer = config.CF_ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  jwks ??= createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: config.CF_ACCESS_AUDIENCE,
    algorithms: ["RS256"],
  });

  if (typeof payload.email !== "string" || !payload.email.includes("@")) {
    throw new Error("Cloudflare Access assertion has no verified email");
  }
  return payload.email.trim().toLocaleLowerCase("en-US");
}

async function principalFromHostedSession(
  sql: Sql,
  requestHeaders: Headers,
): Promise<InternalPrincipal | null> {
  const token = cookieValue(requestHeaders, INTERNAL_SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const [principal] = await sql<InternalPrincipal[]>`
    UPDATE internal_session AS session
    SET last_seen_at = now()
    FROM internal_user AS internal
    WHERE session.token_hash = ${tokenHash}
      AND session.internal_user_id = internal.id
      AND session.expires_at > now()
      AND internal.active
    RETURNING internal.id, internal.email,
      internal.display_name AS "displayName", internal.role::text
  `;
  return principal ?? null;
}

export async function requireInternalPrincipal(
  sql: Sql,
  requestHeaders: Headers,
  allowedRoles: readonly InternalRole[],
): Promise<InternalPrincipal> {
  const email = await cloudflareEmail(requestHeaders);
  let principal: InternalPrincipal | null = null;

  if (email) {
    const [matched] = await sql<InternalPrincipal[]>`
      UPDATE internal_user SET last_authenticated_at = now()
      WHERE email = ${email} AND active
      RETURNING id, email, display_name AS "displayName", role::text
    `;
    principal = matched ?? null;
  } else {
    principal = await principalFromHostedSession(sql, requestHeaders);
  }

  if (!principal || !allowedRoles.includes(principal.role)) {
    throw new Error("Internal access is not authorized");
  }
  return principal;
}
