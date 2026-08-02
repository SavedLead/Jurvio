import type postgres from "postgres";
import { canApprovePrivacyAction, canFinalizePrivacyDecision, type PrivacyRequestDecision, type PrivacyVerificationStatus } from "../domain/privacy-policy";

type Sql = ReturnType<typeof postgres>;
type TransactionSql = postgres.TransactionSql;

async function audit(sql: TransactionSql, input: { requestId: string; actorId: string; eventType: string; prior: unknown; next: unknown; reason?: string }) {
  await sql`
    INSERT INTO privacy_audit_event
      (privacy_request_id, actor_internal_user_id, event_type, prior_state, new_state, reason)
    VALUES (${input.requestId}, ${input.actorId}, ${input.eventType}, ${sql.json(input.prior as never)}, ${sql.json(input.next as never)}, ${input.reason ?? null})
  `;
}

export async function updatePrivacyVerification(sql: Sql, input: {
  requestId: string;
  actorId: string;
  status: PrivacyVerificationStatus;
  provider?: string;
  reference?: string;
  reason: string;
}) {
  if (input.status === "verified" && (!input.provider?.trim() || !input.reference?.trim())) {
    throw new Error("Verified identity requires an opaque provider reference");
  }
  await sql.begin(async (tx) => {
    const [current] = await tx<Array<{ identityStatus: string }>>`
      SELECT identity_status::text AS "identityStatus" FROM privacy_request
      WHERE id = ${input.requestId} FOR UPDATE
    `;
    if (!current) throw new Error("Privacy request not found");
    await tx`
      UPDATE privacy_request SET
        identity_status = ${input.status},
        verification_provider = ${input.provider?.trim() || null},
        verification_reference = ${input.reference?.trim() || null},
        verification_completed_at = ${input.status === "verified" ? new Date() : null},
        status = CASE WHEN ${input.status} = 'pending' THEN 'identity_pending'::privacy_request_status
          WHEN ${input.status} = 'verified' THEN 'in_review'::privacy_request_status ELSE status END
      WHERE id = ${input.requestId}
    `;
    await audit(tx, { requestId: input.requestId, actorId: input.actorId, eventType: "identity_verification_updated", prior: current, next: { status: input.status, provider: input.provider ?? null, reference: input.reference ?? null }, reason: input.reason });
  });
}

export async function decidePrivacyRequest(sql: Sql, input: {
  requestId: string;
  actorId: string;
  decision: PrivacyRequestDecision;
  notes: string;
}) {
  await sql.begin(async (tx) => {
    const [current] = await tx<Array<{ status: string; identityStatus: PrivacyVerificationStatus }>>`
      SELECT status::text, identity_status::text AS "identityStatus" FROM privacy_request
      WHERE id = ${input.requestId} FOR UPDATE
    `;
    if (!current) throw new Error("Privacy request not found");
    if (!canFinalizePrivacyDecision({ identityStatus: current.identityStatus, decision: input.decision, reviewerNotes: input.notes })) {
      throw new Error("Privacy decision does not satisfy manual review policy");
    }
    await tx`
      UPDATE privacy_request SET status = ${input.decision}, decision_notes = ${input.notes.trim()},
        reviewed_at = now(), assigned_to = COALESCE(assigned_to, ${input.actorId})
      WHERE id = ${input.requestId}
    `;
    await audit(tx, { requestId: input.requestId, actorId: input.actorId, eventType: "request_decided", prior: current, next: { status: input.decision }, reason: input.notes.trim() });
  });
}

export async function approvePrivacyAction(sql: Sql, input: {
  actionId: string;
  actorId: string;
  reason: string;
}) {
  await sql.begin(async (tx) => {
    const [action] = await tx<Array<{ requestId: string; proposedBy: string; status: string }>>`
      SELECT target.privacy_request_id::text AS "requestId", action.proposed_by::text AS "proposedBy", action.status::text
      FROM privacy_action action JOIN privacy_request_target target ON target.id = action.privacy_request_target_id
      WHERE action.id = ${input.actionId} FOR UPDATE
    `;
    if (!action) throw new Error("Privacy action not found");
    if (action.status !== "proposed") throw new Error("Only proposed actions may be approved");
    if (!canApprovePrivacyAction(action.proposedBy, input.actorId)) throw new Error("A second reviewer must approve the proposed remedy");
    await tx`UPDATE privacy_action SET status = 'approved', approved_by = ${input.actorId}, approved_at = now() WHERE id = ${input.actionId}`;
    await audit(tx, { requestId: action.requestId, actorId: input.actorId, eventType: "remedy_approved_not_applied", prior: { status: action.status }, next: { status: "approved" }, reason: input.reason });
  });
}
