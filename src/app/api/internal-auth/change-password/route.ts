import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { INTERNAL_SESSION_COOKIE } from "@/modules/identity/cloudflare-access";

const scrypt = promisify(scryptCallback);

function normalizedHost(value: string | null) {
  return (value ?? "").split(",")[0]?.trim().split(":")[0]?.toLowerCase();
}
function isCommandCenterHost(request: NextRequest) {
  return [
    normalizedHost(request.headers.get("host")),
    normalizedHost(request.headers.get("x-forwarded-host")),
  ].includes("z.jurvio.com");
}
function commandCenterUrl(path: string) {
  return new URL(path, "https://z.jurvio.com");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function POST(request: NextRequest) {
  if (!isCommandCenterHost(request)) return new NextResponse(null, { status: 404 });
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  if (password !== confirmation) {
    return NextResponse.redirect(commandCenterUrl("/change-password?error=mismatch"), 303);
  }
  if (password.length < 14 || password.length > 256) {
    return NextResponse.redirect(commandCenterUrl("/change-password?error=weak"), 303);
  }

  const token = request.cookies.get(INTERNAL_SESSION_COOKIE)?.value;
  if (!token || token.length < 32) {
    return NextResponse.redirect(commandCenterUrl("/login"), 303);
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const passwordHash = await hashPassword(password);
  const sql = db();
  const [session] = await sql<Array<{ userId: string }>>`
    SELECT internal_user_id AS "userId"
    FROM internal_session
    WHERE token_hash = ${tokenHash} AND expires_at > now()
  `;
  if (!session) {
    return NextResponse.redirect(commandCenterUrl("/login"), 303);
  }

  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE internal_user
      SET password_hash = ${passwordHash}, must_change_password = false, updated_at = now()
      WHERE id = ${session.userId} AND active AND role = 'administrator'
    `;
    await transaction`
      DELETE FROM internal_session
      WHERE internal_user_id = ${session.userId} AND token_hash <> ${tokenHash}
    `;
  });

  const response = NextResponse.redirect(commandCenterUrl("/"), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
