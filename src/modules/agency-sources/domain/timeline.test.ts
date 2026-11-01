import { describe, expect, it } from "vitest";
import { agencyTimelineEvents } from "./timeline";

describe("agency timeline events", () => {
  it("reads dated filing labels and ignores undated or malformed ones", () => {
    const events = agencyTimelineEvents([{
      publisher: "Federal Trade Commission",
      documents: [
        { url: "https://www.ftc.gov/a.pdf", label: "2026-10-13: Plaintiffs’ Motion for an Order to Show Cause", kind: "motion" },
        { url: "https://www.ftc.gov/b.pdf", label: "Complaint", kind: "complaint" },
        { url: "https://www.ftc.gov/c.pdf", label: "2026-13-45: Bad date", kind: "other" },
        { url: "https://www.ftc.gov/d.pdf", label: "2022-01-14: Opinion and Order", kind: "opinion" },
      ],
    }]);
    expect(events).toEqual([
      { date: "2026-10-13", label: "Plaintiffs’ Motion for an Order to Show Cause (per Federal Trade Commission)" },
      { date: "2022-01-14", label: "Opinion and Order (per Federal Trade Commission)" },
    ]);
  });
});
