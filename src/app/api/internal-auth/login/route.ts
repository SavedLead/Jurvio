import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { INTERNAL_SESSION_COOKIE } from "@/modules/identity/cloudflare-access";

const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 60 * 60 * 12;

function safeHost(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return host.split(",")[0]?.trim().split(":")[0]?.toLowerCase();
}

async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, salt, stored] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !stored) return false;
  const expected = Buffer.from(stored, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: NextRequest) {
  if (safeHost(request) !== "z.jurvio.com") {
    return new NextResponse(null, { status: 404 });
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const sql = db();

  const [attempt] = await sql<Array<{ failures: number }>>`
    INSERT INTO internal_login_attempt (email, ip_hash, failures, window_started_at)
    VALUES (${email}, ${ipHash}, 1, now())
    ON CONFLICT (email, ip_hash) DO UPDATE SET
      failures = CASE
        WHEN internal_login_attempt.window_started_at < now() - interval '15 minutes' THEN 1
        ELSE internal_login_attempt.failures + 1
      END,
      window_started_at = CASE
        WHEN internal_login_attempt.window_started_at < now() - interval '15 minutes' THEN now()
        ELSE internal_login_attempt.window_started_at
      END
    RETURNING failures
  `;

  if (!attempt || attempt.failures > 8) {
    return NextResponse.redirect(new URL("/login?error=locked", request.url), 303);
  }

  const [user] = await sql<Array<{ id: string; passwordHash: string | null }>>`
    SELECT id, password_hash AS "passwordHash"
    FROM internal_user
    WHERE email = ${email} AND active AND role = 'administrator'
  `;

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), 303);
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await sql.begin(async (transaction) => {
    await transaction`DELETE FROM internal_login_attempt WHERE email = ${email} AND ip_hash = ${ipHash}`;
    await transaction`
      INSERT INTO internal_session (token_hash, internal_user_id, expires_at)
      VALUES (${tokenHash}, ${user.id}, now() + interval '12 hours')
    `;
    await transaction`
      UPDATE internal_user SET last_authenticated_at = now() WHERE id = ${user.id}
    `;
  });

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(INTERNAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
