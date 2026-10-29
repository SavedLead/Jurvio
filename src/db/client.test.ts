import { describe, expect, it } from "vitest";
import { databaseSessionSettings } from "./client";

describe("database session settings", () => {
  it("gives the public site a larger pool and a little parallelism", () => {
    const session = databaseSessionSettings({});
    expect(session.worker).toBe(false);
    expect(session.max).toBe(8);
    expect(session.connection.application_name).toBe("jurvio-web");
    expect(session.connection.statement_timeout).toBe(20_000);
    expect(session.connection.max_parallel_workers_per_gather).toBe(2);
  });

  it("keeps a scheduler lane off parallel scans and on a short statement budget", () => {
    const session = databaseSessionSettings({ JURVIO_SCHEDULER_LANE: "core" });
    expect(session.worker).toBe(true);
    expect(session.max).toBe(2);
    expect(session.connection.application_name).toBe("jurvio-core");
    expect(session.connection.statement_timeout).toBe(30_000);
    expect(session.connection.lock_timeout).toBe(5_000);
    expect(session.connection.max_parallel_workers_per_gather).toBe(0);
  });

  it("treats JURVIO_DB_WORKER as a worker even without a scheduler lane", () => {
    const session = databaseSessionSettings({ JURVIO_DB_WORKER: "1", JURVIO_DB_POOL_MAX: "3" });
    expect(session.worker).toBe(true);
    expect(session.max).toBe(3);
    expect(session.connection.application_name).toBe("jurvio-worker");
  });
});
