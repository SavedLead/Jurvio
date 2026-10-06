export const INTELLIGENCE_ANSWER_VERSION = "2026-08-01" as const;

export type EvidenceStatus = "verified" | "inferred" | "classified" | "unavailable";
export type QualityLevel = "high" | "moderate" | "limited" | "insufficient";

export type CohortDefinition = {
  label: string;
  courts: readonly string[];
  filedFrom: string | null;
  filedTo: string | null;
  filters: Readonly<Record<string, readonly string[]>>;
};

export type EvidenceRecord = {
  casePublicId: string;
  caseCaption: string;
  sourceArtifactIds: readonly string[];
  documentPublicIds: readonly string[];
  status: EvidenceStatus;
};

export type IntelligenceMetric = {
  key: string;
  label: string;
  definition: string;
  numerator: number | null;
  denominator: number;
  unknownCount: number;
  value: number | null;
  unit: "count" | "percent" | "days";
  supportingEvidenceIds: readonly string[];
};

export type CoverageSummary = {
  expectedRecords: number | null;
  collectedRecords: number;
  analyzedRecords: number;
  lastRefreshedAt: string;
  quality: QualityLevel;
  limitations: readonly string[];
};

export type IntelligenceAnswer = {
  contractVersion: typeof INTELLIGENCE_ANSWER_VERSION;
  answer: string;
  cohort: CohortDefinition;
  cohortSize: number;
  metrics: readonly IntelligenceMetric[];
  coverage: CoverageSummary;
  evidence: readonly EvidenceRecord[];
  exclusions: readonly string[];
  methodology: readonly string[];
  generatedAt: string;
};

export function percentageMetric(input: {
  key: string;
  label: string;
  definition: string;
  numerator: number;
  denominator: number;
  unknownCount: number;
  supportingEvidenceIds: readonly string[];
}): IntelligenceMetric {
  const { numerator, denominator, unknownCount } = input;
  if (![numerator, denominator, unknownCount].every(Number.isInteger)) {
    throw new Error("Metric counts must be integers");
  }
  if (numerator < 0 || denominator < 0 || unknownCount < 0) {
    throw new Error("Metric counts cannot be negative");
  }
  if (numerator > denominator) {
    throw new Error("Metric numerator cannot exceed denominator");
  }

  return {
    ...input,
    value: denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(1)),
    unit: "percent",
  };
}

export function assertAuditableAnswer(answer: IntelligenceAnswer): void {
  if (answer.contractVersion !== INTELLIGENCE_ANSWER_VERSION) {
    throw new Error("Unsupported intelligence answer contract");
  }
  if (answer.answer.trim().length === 0) throw new Error("Answer summary is required");
  if (answer.cohortSize < 0 || !Number.isInteger(answer.cohortSize)) {
    throw new Error("Cohort size must be a non-negative integer");
  }
  if (answer.coverage.analyzedRecords > answer.coverage.collectedRecords) {
    throw new Error("Analyzed records cannot exceed collected records");
  }

  const evidenceIds = new Set(answer.evidence.flatMap((record) => [
    ...record.sourceArtifactIds,
    ...record.documentPublicIds,
  ]));

  for (const metric of answer.metrics) {
    if (metric.denominator + metric.unknownCount > answer.cohortSize) {
      throw new Error(`Metric ${metric.key} exceeds cohort size`);
    }
    if (metric.supportingEvidenceIds.length === 0 && metric.value !== null) {
      throw new Error(`Metric ${metric.key} has no supporting evidence`);
    }
    for (const evidenceId of metric.supportingEvidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Metric ${metric.key} references missing evidence ${evidenceId}`);
      }
    }
  }
}
