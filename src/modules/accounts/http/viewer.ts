import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { getSessionUser } from "../application/sign-in";
import { userHasSubscriberAccess } from "../application/subscriber-access";
import { SESSION_COOKIE } from "../domain/tokens";

/**
 * True when this request carries a session for a customer on an active paid
 * plan. Requests without the session cookie never touch the database. Pages
 * that call this are per-viewer; the middleware already keeps any request with
 * a customer session out of the shared edge cache.
 */
export const viewerHasSubscriberAccess = cache(async (): Promise<boolean> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    const sql = db();
    const user = await getSessionUser(sql, token);
    return user ? await userHasSubscriberAccess(sql, user.userId) : false;
  } catch {
    return false;
  }
});
