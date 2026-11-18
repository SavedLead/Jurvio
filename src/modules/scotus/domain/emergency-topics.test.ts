import { describe, expect, it } from "vitest";
import { classifyEmergencyTopics, relatedEmergencyDockets } from "./emergency-topics";

describe("emergency topics", () => {
  it("reads topics from the public words and marks a capital case", () => {
    const topics = classifyEmergencyTopics("Application to stay removal of an asylum seeker", {});
    expect(topics.map((topic) => topic.slug)).toContain("immigration");
    const capital = classifyEmergencyTopics("Stay application", { capital: true });
    expect(capital.map((topic) => topic.slug)).toContain("death-penalty");
  });

  it("keeps other emergency docket numbers and drops this case", () => {
    expect(relatedEmergencyDockets("26A100", ["See also No. 26A200 and No. 26A100."])).toEqual(["26A200"]);
  });
});
