import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { LoadGovernor } from "./progress";
import { streamStage } from "./stage-runner";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("bulk stage runner (database)", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 2, onnotice: () => undefined });
  afterAll(() => sql.end({ timeout: 5 }));

  it("skips rows that fail validation and retries a batch after a deadlock", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jurvio-stage-"));
    const filePath = path.join(directory, "rows.csv.bz2");
    const text = 'id,value\n"1","a"\n"x","bad"\n"2","b"\n"3","c"\n';
    await writeFile(filePath, spawnSync("bzip2", ["-c"], { input: text }).stdout);
    const snapshotDate = `${randomInt(2100, 9000)}-01-01`;
    const stage = `test-stage-${randomInt(1e6, 9e6)}`;
    const events: Record<string, unknown>[] = [];
    let attempts = 0;
    const merged: string[] = [];
    try {
      const run = await streamStage<string>({
        sql,
        snapshotDate,
        stage,
        filePath,
        governor: new LoadGovernor({ targetBatchMs: 60_000, maxPauseMs: 0, sizeCheckEvery: 99 }),
        columns: ["id"],
        accept: (column) => {
          if (!/^\d+$/.test(column(0))) throw new Error(`invalid id ${column(0)}`);
          return column(0);
        },
        batchRows: 10,
        retryDelayMs: 1,
        merge: async (_tx, rows) => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
          merged.push(...rows);
          return { matched: rows.length, written: rows.length };
        },
        log: (event) => events.push(event),
      });
      expect(run).toMatchObject({ status: "completed", rowsScanned: 4, rowsWritten: 3, rowsRejected: 1 });
      expect(merged).toEqual(["1", "2", "3"]);
      expect(attempts).toBe(2);
      expect(events.map((event) => event.event)).toEqual(["row_rejected", "batch_retry"]);
      const [progress] = await sql<{ rows_scanned: string; done: boolean }[]>`
        SELECT rows_scanned, done FROM cl_bulk_ingest_progress
        WHERE snapshot_date = ${snapshotDate} AND stage = ${stage}`;
      expect(progress).toEqual({ rows_scanned: "4", done: true });
    } finally {
      await sql`DELETE FROM cl_bulk_ingest_progress WHERE snapshot_date = ${snapshotDate} AND stage = ${stage}`;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
