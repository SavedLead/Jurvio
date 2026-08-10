import { describe, expect, it } from "vitest";
import {
  assertZeroCost,
  evaluatePacerAccess,
  isPacerEnabled,
  PacerChargeError,
  pacerLedgerRow,
  type PacerAccessRequest,
} from "./pacer-guardrail";

const base: PacerAccessRequest = {
  kind: "written_opinion_report",
  courtCode: "txwd",
  sourceReference: "written-opinions/txwd/2026-08-10",
};

describe("PACER guardrail", () => {
  it("is disabled by default (no PACER_ENABLED)", () => {
    expect(isPacerEnabled({})).toBe(false);
    expect(isPacerEnabled({ PACER_ENABLED: "false" })).toBe(false);
    expect(isPacerEnabled({ PACER_ENABLED: "1" })).toBe(false);
    expect(isPacerEnabled({ PACER_ENABLED: "true" })).toBe(true);
  });

  it("blocks everything while disabled, even a free opinion report", () => {
    const d = evaluatePacerAccess(base, { enabled: false });
    expect(d).toEqual({ allowed: false, reason: "pacer_disabled", shutoff: false });
  });

  it("allows a free written-opinion report when enabled with no charge signal", () => {
    const d = evaluatePacerAccess(base, { enabled: true });
    expect(d).toEqual({ allowed: true, reason: "allowed_free_opinion", shutoff: false });
  });

  it("allows a written-opinion document only when explicitly free with 0 pages/cost", () => {
    const ok = evaluatePacerAccess(
      { ...base, kind: "written_opinion_document", freeWrittenOpinion: true },
      { enabled: true },
    );
    expect(ok.allowed).toBe(true);

    const unverified = evaluatePacerAccess(
      { ...base, kind: "written_opinion_document", freeWrittenOpinion: false },
      { enabled: true },
    );
    expect(unverified).toEqual({
      allowed: false,
      reason: "unverified_free_opinion",
      shutoff: false,
    });
  });

  it.each(["docket_report", "case_search", "pacer_search", "document_request"] as const)(
    "hard-blocks paid transaction %s even when enabled",
    (kind) => {
      const d = evaluatePacerAccess({ ...base, kind }, { enabled: true });
      expect(d).toEqual({ allowed: false, reason: "paid_transaction_blocked", shutoff: false });
    },
  );

  it("blocks AND demands shutoff on any charge signal (cost or billable pages)", () => {
    const byCost = evaluatePacerAccess({ ...base, estimatedCostCents: 10 }, { enabled: true });
    expect(byCost).toEqual({ allowed: false, reason: "charge_signal_detected", shutoff: true });

    const byPages = evaluatePacerAccess(
      { ...base, kind: "written_opinion_document", freeWrittenOpinion: true, billablePages: 3 },
      { enabled: true },
    );
    expect(byPages).toEqual({ allowed: false, reason: "charge_signal_detected", shutoff: true });
  });

  it("assertZeroCost throws on any positive cost and passes at $0", () => {
    expect(() => assertZeroCost(0)).not.toThrow();
    expect(() => assertZeroCost(undefined)).not.toThrow();
    expect(() => assertZeroCost(1)).toThrow(PacerChargeError);
  });

  it("ledger rows never record a nonzero actual cost", () => {
    const row = pacerLedgerRow({ ...base, estimatedCostCents: 250, artifactContentHash: "abc" });
    expect(row.actual_cost_cents).toBe(0);
    expect(row.estimated_cost_cents).toBe(250);
    expect(row.transaction_type).toBe("written_opinion_report");
    expect(row.artifact_content_hash).toBe("abc");
  });
});
