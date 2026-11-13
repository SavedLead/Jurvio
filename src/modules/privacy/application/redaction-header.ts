import http from "node:http";
import postgres from "postgres";

const HEADER = "noindex, noarchive, nosnippet";
let paths = new Set<string>();
let installed = false;

async function refresh(sql: ReturnType<typeof postgres>) {
  try {
    const rows = await sql<{ path: string }[]>`SELECT path FROM redaction_hits`;
    paths = new Set(rows.map((row) => row.path));
  } catch {
    // The table is absent until the migration runs. Keep the last set.
  }
}

/** Sets X-Robots-Tag on the first response for a redacted URL, before the edge cache stores it. */
export function installRedactionHeader(): void {
  if (installed) return;
  installed = true;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1, connection: { application_name: "jurvio-redaction-header" } });
  void refresh(sql);
  const timer = setInterval(() => void refresh(sql), 30_000);
  timer.unref?.();
  const original = http.ServerResponse.prototype.writeHead;
  http.ServerResponse.prototype.writeHead = function writeHead(this: http.ServerResponse, ...args: unknown[]) {
    const url = this.req?.url ?? "";
    const path = url.split("?")[0] ?? "";
    if (paths.has(path)) this.setHeader("X-Robots-Tag", HEADER);
    return original.apply(this, args as never);
  } as typeof http.ServerResponse.prototype.writeHead;
}
