import { describe, expect, it } from "vitest";
import {
  INTELLIGENCE_ANSWER_VERSION,
  assertAuditableAnswer,
  percentageMetric,
  type IntelligenceAnswer,
} from "./answer-contract";

function answer(): IntelligenceAnswer {
  return {
    contractVersion: INTELLIGENCE_ANSWER_VERSION,
    answer: "Four of five supported motions were granted.",
    cohort: { label: "Test cohort", courts: ["nysd"], filedFrom: "2024-01-01", filedTo: null, filters: {} },
    cohortSize: 7,
    metrics: [percentageMetric({
      key: "motion-grant-rate",
      label: "Grant rate",
      definition: "Supported granted motions divided by supported decided motions.",
      numerator: 4,
      denominator: 5,
      unknownCount: 2,
      supportingEvidenceIds: ["document-1"],
    })],
    coverage: {
      expectedRecords: 7,
      collectedRecords: 7,
      analyzedRecords: 5,
      lastRefreshedAt: "2026-08-02T00:00:00.000Z",
      quality: "moderate",
      limitations: ["Two records have no supported outcome."],
    },
    evidence: [{
      casePublicId: "case-1",
      caseCaption: "Example v. Example",
      sourceArtifactIds: ["source-1"],
      documentPublicIds: ["document-1"],
      status: "verified",
    }],
    exclusions: ["Unknown outcomes are excluded from the denominator."],
    methodology: ["The calculation is deterministic."],
    generatedAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("percentageMetric", () => {
  it("preserves the denominator and unknown count", () => {
    expect(percentageMetric({ key: "x", label: "X", definition: "X", numerator: 2, denominator: 3, unknownCount: 4, supportingEvidenceIds: ["d"] }))
      .toMatchObject({ value: 66.7, denominator: 3, unknownCount: 4 });
  });

  it("does not invent a percentage for an empty denominator", () => {
    expect(percentageMetric({ key: "x", label: "X", definition: "X", numerator: 0, denominator: 0, unknownCount: 4, supportingEvidenceIds: [] }).value).toBeNull();
  });
});

describe("assertAuditableAnswer", () => {
  it("accepts an evidence-backed answer", () => expect(() => assertAuditableAnswer(answer())).not.toThrow());

  it("rejects an answer whose metric evidence is absent", () => {
    const invalid = answer();
    invalid.metrics = [{ ...invalid.metrics[0]!, supportingEvidenceIds: ["missing"] }];
    expect(() => assertAuditableAnswer(invalid)).toThrow("references missing evidence");
  });

  it("rejects hidden unknowns outside the cohort", () => {
    const invalid = answer();
    invalid.metrics = [{ ...invalid.metrics[0]!, unknownCount: 3 }];
    expect(() => assertAuditableAnswer(invalid)).toThrow("exceeds cohort size");
  });
});
