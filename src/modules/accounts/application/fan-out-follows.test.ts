import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isFanOutKind } from "../domain/entity-follow";

describe("fan-out follows are paid", () => {
  it("treats judge, court, party, and topic as fan-out, and leaves cases and emergency free", () => {
    expect(isFanOutKind("judge")).toBe(true);
    expect(isFanOutKind("court")).toBe(true);
    expect(isFanOutKind("party")).toBe(true);
    expect(isFanOutKind("topic")).toBe(true);
    expect(isFanOutKind("emergency")).toBe(false);
  });

  it("refuses a free account in the server follow function and keeps the row", () => {
    const follows = readFileSync("src/modules/accounts/application/entity-follows.ts", "utf8");
    const lane = readFileSync("src/modules/ingestion/application/followed-item-priority.ts", "utf8");
    const migration = readFileSync("db/migrations/0211_fanout_follows_paid.sql", "utf8");
    expect(follows).toContain('return "paid_required"');
    expect(lane).toContain("s.plan IN ('plus', 'pro', 'team')");
    expect(migration).toContain("needs_upgrade");
    expect(migration).not.toContain("DELETE FROM entity_follow");
  });
});
