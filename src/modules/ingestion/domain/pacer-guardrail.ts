// PACER zero-dollar guardrail.
//
// Jurvio never spends money on PACER. PACER access is DISABLED by default and,
// even when explicitly enabled, this guardrail permits ONLY confirmed-free
// written-opinion access and hard-blocks every chargeable transaction (case
// searches, docket reports, and chargeable document requests). Any charge
// signal whatsoever (a positive estimated cost or any billable page) blocks the
// request AND demands an immediate shutoff of PACER activity.
//
// This module is intentionally pure so the $0 enforcement is exhaustively
// unit-testable. PACER credentials must not be stored or used until these rules
// exist and pass tests; this is that enforcement layer.

export type PacerTransactionKind =
  | "written_opinion_report" // the court "Written Opinions" report — free
  | "written_opinion_document" // a document the source marks a free written opinion (0 billable pages)
  | "docket_report" // PAID
  | "case_search" // PAID
  | "pacer_search" // PAID
  | "document_request"; // PAID (chargeable document)

const FREE_KINDS: ReadonlySet<PacerTransactionKind> = new Set([
  "written_opinion_report",
  "written_opinion_document",
]);

export interface PacerAccessRequest {
  readonly kind: PacerTransactionKind;
  readonly courtCode: string;
  readonly sourceReference: string;
  /** Only meaningful for written_opinion_document: the source explicitly marks it a free written opinion. */
  readonly freeWrittenOpinion?: boolean;
  /** Any observed cost signal, in cents. Undefined = unknown. */
  readonly estimatedCostCents?: number;
  /** Any observed billable page count. Undefined = unknown. */
  readonly billablePages?: number;
  readonly artifactContentHash?: string;
}

export type PacerDenyReason =
  | "pacer_disabled"
  | "paid_transaction_blocked"
  | "charge_signal_detected"
  | "unverified_free_opinion";

export interface PacerDecision {
  readonly allowed: boolean;
  readonly reason: "allowed_free_opinion" | PacerDenyReason;
  /** True when a charge signal was seen and PACER activity must halt immediately. */
  readonly shutoff: boolean;
}

export class PacerChargeError extends Error {
  constructor(public readonly cents: number) {
    super(`PACER charge signal detected (${cents} cents); PACER must remain $0`);
    this.name = "PacerChargeError";
  }
}

/** PACER is off unless PACER_ENABLED is the literal "true". */
export function isPacerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PACER_ENABLED === "true";
}

function hasChargeSignal(request: PacerAccessRequest): boolean {
  return (request.estimatedCostCents ?? 0) > 0 || (request.billablePages ?? 0) > 0;
}

/**
 * Decide whether a PACER access request is permitted. Allows only confirmed-free
 * written-opinion access with a zero cost signal; blocks everything else. A
 * charge signal always blocks and demands shutoff.
 */
export function evaluatePacerAccess(
  request: PacerAccessRequest,
  opts: { enabled: boolean },
): PacerDecision {
  if (!opts.enabled) return { allowed: false, reason: "pacer_disabled", shutoff: false };

  // A charge signal overrides everything: block and halt.
  if (hasChargeSignal(request)) {
    return { allowed: false, reason: "charge_signal_detected", shutoff: true };
  }

  if (!FREE_KINDS.has(request.kind)) {
    return { allowed: false, reason: "paid_transaction_blocked", shutoff: false };
  }

  if (request.kind === "written_opinion_document" && request.freeWrittenOpinion !== true) {
    // A document is only free when the source explicitly confirms it a written opinion.
    return { allowed: false, reason: "unverified_free_opinion", shutoff: false };
  }

  return { allowed: true, reason: "allowed_free_opinion", shutoff: false };
}

/** Throws if any nonzero cost is observed. Call at every PACER boundary. */
export function assertZeroCost(costCents: number | undefined): void {
  const cents = costCents ?? 0;
  if (cents > 0) throw new PacerChargeError(cents);
}

export interface PacerLedgerRow {
  readonly court_code: string;
  readonly transaction_type: PacerTransactionKind;
  readonly source_reference: string;
  readonly estimated_cost_cents: number;
  readonly actual_cost_cents: number;
  readonly artifact_content_hash: string | null;
}

/**
 * Build a pacer_cost_ledger row for an evaluated request. Allowed free access is
 * recorded at $0 actual cost; a blocked/charge-signalled request records the
 * observed estimate so the shutoff is auditable. Never returns a nonzero actual
 * cost — Jurvio does not spend on PACER.
 */
export function pacerLedgerRow(request: PacerAccessRequest): PacerLedgerRow {
  return {
    court_code: request.courtCode,
    transaction_type: request.kind,
    source_reference: request.sourceReference,
    estimated_cost_cents: Math.max(0, Math.trunc(request.estimatedCostCents ?? 0)),
    actual_cost_cents: 0,
    artifact_content_hash: request.artifactContentHash ?? null,
  };
}
