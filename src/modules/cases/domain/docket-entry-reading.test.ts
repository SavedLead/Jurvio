import { describe, expect, it } from "vitest";
import { docketEntryKind, namedParties, statedOutcome } from "./docket-entry-reading";

describe("docket entry reading", () => {
  it("labels the line from the words the court used", () => {
    expect(docketEntryKind("COMPLAINT against Google")).toBe("complaint");
    expect(docketEntryKind("MOTION to dismiss")).toBe("motion");
    expect(docketEntryKind("ORDER granting the motion to dismiss")).toBe("order");
    expect(docketEntryKind("Summons issued")).toBe("summons");
    expect(docketEntryKind("NOTICE of appearance")).toBe("notice");
    expect(docketEntryKind("MDL member case opening")).toBe("other");
  });

  it("repeats an outcome only when the entry states one", () => {
    expect(statedOutcome("ORDER granting motion to dismiss")).toMatch(/granting motion to dismiss/i);
    expect(statedOutcome("MOTION to dismiss filed")).toBeNull();
    expect(statedOutcome("Summons issued")).toBeNull();
  });

  it("names a party only when the entry contains that name", () => {
    expect(namedParties("MOTION by Deutsch to dismiss", ["UCS Trading Inc", "Deutsch"])).toEqual(["Deutsch"]);
    expect(namedParties("Summons issued", ["UCS Trading Inc", "Deutsch"])).toEqual([]);
    expect(namedParties("filed by U", ["U"])).toEqual([]);
  });
});
