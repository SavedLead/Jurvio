import { describe, expect, it } from "vitest";
import { changeEventDedupKey, isWatchTargetType, WATCH_TARGET_TYPES } from "./monitoring";

describe("isWatchTargetType", () => {
  it("accepts every declared target type", () => {
    for (const t of WATCH_TARGET_TYPES) {
      expect(isWatchTargetType(t)).toBe(true);
    }
  });

  it("rejects unknown target types", () => {
    expect(isWatchTargetType("docket_entry")).toBe(false);
    expect(isWatchTargetType("")).toBe(false);
    expect(isWatchTargetType("CASE")).toBe(false);
  });
});

describe("changeEventDedupKey", () => {
  const base = {
    subjectType: "case",
    subjectRef: "11111111-1111-1111-1111-111111111111",
    kind: "judgment_entered",
    sourceKey: "opinion-42",
  } as const;

  it("is stable for identical inputs", () => {
    expect(changeEventDedupKey(base)).toBe(changeEventDedupKey({ ...base }));
  });

  it("differs when any component differs", () => {
    const key = changeEventDedupKey(base);
    expect(changeEventDedupKey({ ...base, kind: "status_changed" })).not.toBe(key);
    expect(changeEventDedupKey({ ...base, sourceKey: "opinion-43" })).not.toBe(key);
    expect(changeEventDedupKey({ ...base, subjectRef: "22222222-2222-2222-2222-222222222222" })).not.toBe(key);
  });
});
