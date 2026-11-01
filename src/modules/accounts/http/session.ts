import { cookies } from "next/headers";
import { db } from "@/db/client";
import { getSessionUser, type SessionUser } from "../application/sign-in";
import { SESSION_COOKIE } from "../domain/tokens";

/** Current signed-in customer for server components and route handlers (never cached pages). */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(db(), token).catch(() => null);
}
