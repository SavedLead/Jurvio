import { describe, expect, it } from "vitest";
import { buildMotionGuide, motionKind, readPlainMotion } from "./motion-guide";

describe("motion kinds", () => {
  it("prefers specific phrases", () => {
    expect(motionKind("MOTION for Partial Summary Judgment")?.key).toBe("partial-summary-judgment");
    expect(motionKind("MOTION for Summary Judgment")?.key).toBe("summary-judgment");
    expect(motionKind("MOTION for Extension of Time to File Answer")?.key).toBe("extend-time");
    expect(motionKind("MOTION for Leave to Proceed in forma pauperis")?.key).toBe("ifp");
    expect(motionKind("MOTION to Withdraw as Attorney")?.key).toBe("withdraw-counsel");
    expect(motionKind("MOTION in Limine to exclude expert")?.key).toBe("limine");
    expect(motionKind("MOTION for Leave to File Excess Pages")?.key).toBe("leave-to-file");
  });
  it("explains every kind without legal jargon left unexplained", () => {
    expect(motionKind("MOTION to Compel Discovery")?.plain).toMatch(/evidence-sharing/);
  });
});

describe("guide", () => {
  const entries = [
    { entryNumber: "12", filedOn: "2024-01-10", description: "MOTION to Dismiss for Failure to State a Claim by Acme Corp. (Attachments: # 1 Memo)", publicId: "de-1" },
    { entryNumber: "15", filedOn: "2024-01-20", description: "MOTION for Extension of Time to File Response by Jane Roe.", publicId: "de-2" },
    { entryNumber: "16", filedOn: "2024-01-21", description: "MOTION to Seal Document 14 by Jane Roe.", publicId: "de-3" },
    { entryNumber: "20", filedOn: "2024-03-01", description: "ORDER granting 15 Motion for Extension of Time; denying 12 Motion to Dismiss. Signed by Judge X.", publicId: "de-4" },
  ];
  it("ties rulings by docket number and skips sealed entries", () => {
    const guide = buildMotionGuide(entries);
    expect(guide.map((m) => [m.kind.key, m.status])).toEqual([["extend-time", "granted"], ["dismiss", "denied"]]);
    expect(guide[1]?.by).toBe("Acme Corp");
  });
  it("does not guess an uncited ruling when it could belong to more than one motion", () => {
    const guide = buildMotionGuide([entries[0]!, { entryNumber: "13", filedOn: "2024-03-02", description: "MOTION to Dismiss by Beta LLC." },
      { entryNumber: "30", filedOn: "2024-04-01", description: "ORDER denying Motion to Dismiss." }]);
    expect(guide.every((motion) => motion.status === "no-ruling-shown")).toBe(true);
  });
  it("ignores non-motions", () => {
    expect(readPlainMotion({ filedOn: null, description: "COMPLAINT against Acme Corp." })).toBeNull();
  });
});

describe("buildMotionGuide uncited orders", () => {
  it("links an uncited order only when it is the single motion and order of that type", () => {
    const one = buildMotionGuide([
      { entryNumber: 12, filedOn: "2024-03-01", description: "MOTION to Dismiss for Failure to State a Claim by Acme Corp." },
      { entryNumber: 31, filedOn: "2024-09-30", description: "MEMORANDUM OPINION and ORDER granting motion to dismiss." },
    ]);
    expect(one[0]).toMatchObject({ status: "granted", rulingEntryNumber: 31, rulingMatchedBy: "only-matching-order" });
    const two = buildMotionGuide([
      { entryNumber: 12, filedOn: "2024-03-01", description: "MOTION to Dismiss by Acme Corp." },
      { entryNumber: 14, filedOn: "2024-03-02", description: "MOTION to Dismiss by Beta LLC." },
      { entryNumber: 31, filedOn: "2024-09-30", description: "ORDER granting motion to dismiss." },
    ]);
    expect(two.every((motion) => motion.status === "no-ruling-shown")).toBe(true);
  });
});
