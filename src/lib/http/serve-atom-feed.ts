import { feedCacheControl } from "@/lib/http/edge-cache";

const lastGood = new Map<string, string>();

/** A failed load serves the last XML this process built, instead of an empty 500. */
export async function serveAtomFeed(name: string, load: () => Promise<string>): Promise<Response> {
  try {
    const body = await load();
    lastGood.set(name, body);
    return xml(body, false);
  } catch {
    const cached = lastGood.get(name);
    if (cached) return xml(cached, true);
    return new Response("This feed is temporarily unavailable.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
}

function xml(body: string, stale: boolean): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/atom+xml; charset=utf-8",
    "Cache-Control": feedCacheControl(200),
  };
  if (stale) headers["X-Jurvio-Feed"] = "stale";
  return new Response(body, { status: 200, headers });
}
