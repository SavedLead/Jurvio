import { describe, expect, it } from "vitest";
import { TOPICS, caseMatchesTopic, nosNumber, topicBySlug, topicMatchSql, topicsForNos } from "./topics";

describe("topics", () => {
  it("has unique slugs and non-overlapping NOS ranges", () => {
    expect(new Set(TOPICS.map((topic) => topic.slug)).size).toBe(TOPICS.length);
    const seen = new Map<number, string>();
    for (const topic of TOPICS) for (const [lo, hi] of topic.ranges) for (let code = lo; code <= hi; code += 1) {
      expect(seen.get(code), `NOS ${code} in ${topic.slug} and ${seen.get(code)}`).toBeUndefined();
      seen.set(code, topic.slug);
    }
  });

  it("matches numbered and text-only NOS values", () => {
    expect(nosNumber("442 Civil Rights: Employment")).toBe(442);
    expect(nosNumber("Civil Rights")).toBeNull();
    expect(topicsForNos("442 Civil Rights: Employment").map((topic) => topic.slug)).toEqual(["civil-rights"]);
    expect(topicsForNos("530 Habeas Corpus (General)").map((topic) => topic.slug)).toEqual(["prisoner-petitions"]);
    expect(topicsForNos("830").map((topic) => topic.slug)).toEqual(["intellectual-property"]);
    expect(caseMatchesTopic(topicBySlug("civil-rights")!, "Civil Rights: Voting")).toBe(true);
    expect(caseMatchesTopic(topicBySlug("civil-rights")!, null)).toBe(false);
    expect(topicsForNos("Puerto Rico contract dispute").map((topic) => topic.slug)).toEqual(["contracts"]);
  });

  it("builds SQL only from the catalog", () => {
    const sql = topicMatchSql(topicBySlug("intellectual-property")!, "c.nature_of_suit_code");
    expect(sql).toContain("BETWEEN 820 AND 840");
    expect(sql).toContain("BETWEEN 880 AND 880");
    expect(() => topicMatchSql(topicBySlug("tax")!, "c.code; DROP TABLE x")).toThrow();
    expect(topicBySlug("../etc")).toBeNull();
  });
});

describe("production NOS formats", () => {
  const cases: Array<[string, string | null]> = [
    ["463 Habeas Corpus - Alien Detainee", "immigration"],
    ["2463 Habeas Corpus - Alien Detainees", "immigration"],
    ["3440 Other Civil Rights", "civil-rights"],
    ["3530 Prisoner Petitions - Habeas Corpus", "prisoner-petitions"],
    ["Civil Rights: Other", "civil-rights"],
    ["Prisoner: Civil Rights", "prisoner-petitions"],
    ["P.I.: Other", "personal-injury"],
    ["Social Security: DIWC/DIWW", "social-security"],
    ["899 Other Statutes: Administrative Procedures Act/Review or Appeal of Agency Decision", "government-records"],
    ["Other Statutory Actions", null],
  ];
  it.each(cases)("%s -> %s", (code, slug) => {
    expect(topicsForNos(code).map((topic) => topic.slug)).toEqual(slug ? [slug] : []);
    expect(nosNumber("12345 x")).toBeNull();
  });
});
