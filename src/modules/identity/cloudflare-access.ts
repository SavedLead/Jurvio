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

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function accessConfiguration() {
  const config = env();
  if (!config.CF_ACCESS_TEAM_DOMAIN || !config.CF_ACCESS_AUDIENCE) {
    throw new Error("Cloudflare Access is not configured");
  }
  return {
    issuer: config.CF_ACCESS_TEAM_DOMAIN.replace(/\/$/, ""),
    audience: config.CF_ACCESS_AUDIENCE,
  };
}

async function verifiedEmail(requestHeaders: Headers): Promise<string> {
  const token = requestHeaders.get("cf-access-jwt-assertion");
  if (!token) throw new Error("Cloudflare Access assertion is missing");

  const { issuer, audience } = accessConfiguration();
  jwks ??= createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
    algorithms: ["RS256"],
  });

  if (typeof payload.email !== "string" || !payload.email.includes("@")) {
    throw new Error("Cloudflare Access assertion has no verified email");
  }
  return payload.email.trim().toLocaleLowerCase("en-US");
}

export async function requireInternalPrincipal(
  sql: Sql,
  requestHeaders: Headers,
  allowedRoles: readonly InternalRole[],
): Promise<InternalPrincipal> {
  const email = await verifiedEmail(requestHeaders);
  const [principal] = await sql<InternalPrincipal[]>`
    UPDATE internal_user SET last_authenticated_at = now()
    WHERE email = ${email} AND active
    RETURNING id, email, display_name AS "displayName", role::text
  `;

  if (!principal || !allowedRoles.includes(principal.role)) {
    throw new Error("Internal access is not authorized");
  }
  return principal;
}
