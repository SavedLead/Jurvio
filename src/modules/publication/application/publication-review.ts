import type postgres from "postgres";
import {
  evaluatePublicationCandidate,
  type PublicationCandidate,
} from "../domain/publication-policy";

type Sql = ReturnType<typeof postgres>;
export type PublishableObjectType = "legal_case" | "docket_entry" | "entity" | "document";

export async function queuePublicationReview(
  sql: Sql,
  input: {
    objectType: PublishableObjectType;
    objectId: string;
    candidate: PublicationCandidate;
    requestedByType: "system" | "agent" | "user";
    requestedById?: string;
    evidence: readonly postgres.JSONValue[];
  },
): Promise<{ reviewId: string; recommendation: "reject" | "manual_review" }> {
  const preflight = evaluatePublicationCandidate(input.candidate);
  const status = preflight.recommendation === "reject" ? "rejected" : "pending";

  const [review] = await sql<{ id: string }[]>`
    INSERT INTO publication_review (
      object_type, object_id, status, requested_by_type, requested_by_id,
      preflight_version, risk_flags, evidence, reviewed_at
    ) VALUES (
      ${input.objectType}, ${input.objectId}, ${status},
      ${input.requestedByType}, ${input.requestedById ?? null},
      ${preflight.version}, ${sql.json(preflight.reasons)},
      ${sql.json(input.evidence)},
      ${status === "rejected" ? new Date().toISOString() : null}
    )
    ON CONFLICT (object_type, object_id)
      WHERE status IN ('pending', 'in_review', 'needs_changes')
    DO UPDATE SET risk_flags = EXCLUDED.risk_flags,
      evidence = EXCLUDED.evidence,
      preflight_version = EXCLUDED.preflight_version
    RETURNING id
  `;
  if (!review) throw new Error("Publication review was not queued");
  return { reviewId: review.id, recommendation: preflight.recommendation };
}

export async function completePublicationReview(
  sql: Sql,
  input: {
    reviewId: string;
    reviewerId: string;
    decision: "approved" | "rejected" | "needs_changes";
    notes?: string;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const [review] = await tx<{
      object_type: PublishableObjectType;
      object_id: string;
      status: string;
    }[]>`
      SELECT object_type, object_id, status
      FROM publication_review
      WHERE id = ${input.reviewId}
      FOR UPDATE
    `;

    if (!review) throw new Error("Publication review was not found");
    if (!["pending", "in_review", "needs_changes"].includes(review.status)) {
      throw new Error("Publication review is already final");
    }

    await tx`
      UPDATE publication_review
      SET status = ${input.decision}, reviewer_id = ${input.reviewerId},
        reviewer_notes = ${input.notes ?? null},
        reviewed_at = CASE WHEN ${input.decision} = 'needs_changes'
          THEN NULL ELSE now() END
      WHERE id = ${input.reviewId}
    `;

    if (input.decision === "needs_changes") return;

    const approved = input.decision === "approved";
    await tx`
      INSERT INTO publication_decision (
        object_type, object_id, displayable, indexable, machine_accessible,
        downloadable, summary_eligible, reason_code, rule_version
      ) VALUES (
        ${review.object_type}, ${review.object_id},
        ${approved}, ${approved}, ${approved},
        false, ${approved && ["legal_case", "document"].includes(review.object_type)},
        ${approved ? "human_approved" : "human_rejected"},
        'manual-publication-v1'
      )
    `;

    if (review.object_type === "legal_case") {
      await tx`
        UPDATE legal_case SET publication = ${approved ? "published" : "suppressed"},
          updated_at = now()
        WHERE id = ${review.object_id}
      `;
    }
    if (review.object_type === "document") {
      await tx`
        UPDATE document SET publication = ${approved ? "published" : "suppressed"},
          updated_at = now()
        WHERE id = ${review.object_id}
      `;
    }

    await tx`
      INSERT INTO outbox_event (
        topic, aggregate_type, aggregate_id, aggregate_version, payload
      ) VALUES (
        'publication.changed', ${review.object_type}, ${review.object_id},
        (extract(epoch from clock_timestamp()) * 1000000)::bigint,
        ${tx.json({ decision: input.decision, reviewId: input.reviewId })}
      )
    `;

    await tx`
      INSERT INTO internal_audit_event (
        actor_internal_user_id, action, target_type, target_id, metadata
      ) VALUES (
        ${input.reviewerId}, 'publication_review.' || ${input.decision},
        ${review.object_type}, ${review.object_id},
        ${tx.json({ reviewId: input.reviewId, notesProvided: Boolean(input.notes) })}
      )
    `;
  });
}
