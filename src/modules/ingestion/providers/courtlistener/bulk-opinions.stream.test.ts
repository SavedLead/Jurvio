import { spawn } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { openBulkCsvFromUrl, readBulkOpinionClusters } from "./bulk-opinions";

// Compress a buffer with the system bzip2 (the same tool the loader decodes with).
function bzip2Compress(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bzip2", ["-z", "-c"]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`bzip2 -z exited ${code}: ${Buffer.concat(err).toString()}`)),
    );
    proc.stdin.end(input);
  });
}

describe("openBulkCsvFromUrl resumable streaming", () => {
  let server: http.Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("resumes with a Range request after a mid-stream abort and decodes the whole file", async () => {
    // Build a clusters CSV large enough that the compressed body splits meaningfully.
    const rowCount = 200;
    const header = "id,docket_id,case_name,date_filed\n";
    let csv = header;
    for (let i = 0; i < rowCount; i += 1) {
      csv += `${1000 + i},${5000 + i},Case Number ${i} In Re Something Lengthy,20${String(10 + (i % 80)).padStart(2, "0")}-01-01\n`;
    }
    const full = await bzip2Compress(Buffer.from(csv, "utf8"));
    expect(full.length).toBeGreaterThan(50); // compressed to a non-trivial body

    let rangeRequests = 0;
    let firstServed = false;
    server = http.createServer((req, res) => {
      const range = req.headers.range;
      if (!range) {
        // First (full) request: advertise the true length, send ~half, then abort.
        firstServed = true;
        res.writeHead(200, {
          "content-length": String(full.length),
          "accept-ranges": "bytes",
        });
        const half = Math.max(1, Math.floor(full.length / 2));
        res.write(full.subarray(0, half));
        // Hard-reset the connection without ending the body -> client sees "aborted".
        setImmediate(() => res.destroy());
        return;
      }
      // Resume request: serve the remaining bytes as a proper 206.
      rangeRequests += 1;
      const match = /bytes=(\d+)-/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const slice = full.subarray(start);
      res.writeHead(206, {
        "content-range": `bytes ${start}-${full.length - 1}/${full.length}`,
        "content-length": String(slice.length),
        "accept-ranges": "bytes",
      });
      res.end(slice);
    });

    const port: number = await new Promise((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const url = `http://127.0.0.1:${port}/opinion-clusters-test.csv.bz2`;
    const ids: string[] = [];
    for await (const row of readBulkOpinionClusters(openBulkCsvFromUrl(url))) {
      ids.push(row.id);
    }

    // The abort happened and was healed via Range, and every row survived intact.
    expect(firstServed).toBe(true);
    expect(rangeRequests).toBeGreaterThanOrEqual(1);
    expect(ids).toHaveLength(rowCount);
    expect(ids[0]).toBe("1000");
    expect(ids[ids.length - 1]).toBe(String(1000 + rowCount - 1));
  }, 30000);

  it("tears down cleanly when the consumer stops early mid-stream (no unhandled EPIPE)", async () => {
    // Regression test for the crash that sank the first throughput run: stopping the
    // consumer early kills bzip2 while the HTTP body is still arriving, so a write
    // lands on bzip2's (Socket) stdin after it's gone -> EPIPE. Without a stdin
    // 'error' handler Node treats that as fatal and crashes the whole process (which
    // would abort this test worker). With the handler it's swallowed during teardown.
    const rowCount = 8000;
    let csv = "id,docket_id,case_name,date_filed\n";
    for (let i = 0; i < rowCount; i += 1) {
      csv += `${2000 + i},${7000 + i},Case ${i},2021-01-01\n`;
    }
    const full = await bzip2Compress(Buffer.from(csv, "utf8"));

    // Trickle the body in small chunks so bzip2 is still being fed when we stop.
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-length": String(full.length), "accept-ranges": "bytes" });
      let off = 0;
      const step = () => {
        if (res.writableEnded || res.destroyed) return;
        if (off >= full.length) {
          res.end();
          return;
        }
        res.write(full.subarray(off, off + 512));
        off += 512;
        setTimeout(step, 2);
      };
      step();
    });
    const port: number = await new Promise((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const url = `http://127.0.0.1:${port}/trickle.csv.bz2`;
    const iterator = readBulkOpinionClusters(openBulkCsvFromUrl(url))[Symbol.asyncIterator]();
    const first = await iterator.next(); // read one row while the body is still trickling
    // Returning the generator runs its `finally` -> source.close(), killing bzip2
    // mid-stream so a still-in-flight HTTP chunk writes to its dead stdin (EPIPE).
    await iterator.return?.(undefined);
    // Let any post-close async stdin write fire its EPIPE so the handler is exercised.
    await new Promise((r) => setTimeout(r, 75));
    expect(first.done).toBe(false);
    expect(first.value?.id).toBe("2000");
  }, 30000);
});
