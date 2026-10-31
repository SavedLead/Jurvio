import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The bulk-volume workflow must never take Postgres or the site down.
const body = readFileSync(join(process.cwd(), ".github", "workflows", "pg-bulk-volume-once.yml"), "utf8");
const script = body.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

describe("pg-bulk-volume-once.yml", () => {
  it("never restarts or recreates postgres and never moves PGDATA", () => {
    expect(script).not.toMatch(/docker (compose[^\n]*)?(restart|stop|kill|rm)\b/);
    expect(script).not.toMatch(/up -d[^\n]*postgres/);
    expect(script).not.toMatch(/pg_ctl|systemctl (restart|stop) docker|reboot|poweroff/);
    expect(script).not.toMatch(/rsync|mv [^\n]*postgresql\/data/);
  });

  it("only formats a device with no filesystem and mounts with nofail", () => {
    expect(script).toContain('if [ -z "$fstype" ]; then');
    expect(script).toMatch(/ext4 defaults,nofail/);
    expect(script.match(/nofail/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("moves indexes concurrently and only loader-only tables", () => {
    expect(script).toContain("REINDEX (TABLESPACE $TS, VERBOSE) INDEX CONCURRENTLY");
    expect(script).toContain("courtlistener_pending_cluster courtlistener_cluster_stage courtlistener_opinion_stage courtlistener_docket_stage");
    expect(script).toContain("live tables are never moved");
    expect(script).toContain("lock_timeout=5s' q \"BEGIN; ALTER TABLE");
  });

  it("creates the tablespace only after checking the path is on the volume", () => {
    const create = script.indexOf("CREATE TABLESPACE");
    const verify = script.indexOf("verify_ts_path\n", script.indexOf("do_tablespace() {"));
    expect(verify).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(verify);
  });
});
