import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface GovernanceCount {
  label: string;
  value: number;
}

export interface GovernanceDashboard {
  publication: {
    cases: GovernanceCount[];
    documents: GovernanceCount[];
    reviews: GovernanceCount[];
    activeReviewCount: number;
    recentDecisions: Array<{
      id: string;
      objectType: string;
      decision: string;
      reviewer: string | null;
      occurredAt: string;
    }>;
  };
  quality: {
    cases: GovernanceCount[];
    courts: GovernanceCount[];
    entities: GovernanceCount[];
    documentConfidence: GovernanceCount[];
    openRejections: number;
    recentRejections: Array<{
      id: string;
      reasonCode: string;
      message: string;
      sourceUri: string;
      lastSeenAt: string;
    }>;
  };
  privacy: {
    suppressedCases: number;
    restrictedCases: number;
    suppressedDocuments: number;
    restrictedDocuments: number;
  };
  demand: {
    eventsLast30Days: number;
    explanationRequestsLast30Days: number;
    enrichmentQueue: GovernanceCount[];
    estimatedQueuedCostMicrousd: number;
    actualCostMicrousd: number;
  };
  agents: {
    awaitingApproval: number;
    unexecutedActions: number;
    enabledDefinitions: number;
    recentRuns: GovernanceCount[];
  };
  audit: Array<{
    id: string;
    action: string;
    actor: string | null;
    targetType: string | null;
    targetId: string | null;
    occurredAt: string;
  }>;
}

export async function getGovernanceDashboard(sql: Sql): Promise<GovernanceDashboard> {
  const [
    casePublication,
    documentPublication,
    reviews,
    recentDecisions,
    caseVerification,
    courtVerification,
    entityVerification,
    documentConfidence,
    rejectionTotal,
    recentRejections,
    demandTotals,
    enrichmentQueue,
    enrichmentCosts,
    agentTotals,
    recentRuns,
    audit,
  ] = await Promise.all([
    sql<GovernanceCount[]>`SELECT publication::text AS label, count(*)::int AS value FROM legal_case GROUP BY publication ORDER BY publication`,
    sql<GovernanceCount[]>`SELECT publication::text AS label, count(*)::int AS value FROM document GROUP BY publication ORDER BY publication`,
    sql<GovernanceCount[]>`SELECT status::text AS label, count(*)::int AS value FROM publication_review GROUP BY status ORDER BY status`,
    sql<GovernanceDashboard["publication"]["recentDecisions"]>`
      SELECT review.id, review.object_type AS "objectType", review.status::text AS decision,
        internal_user.email AS reviewer, review.reviewed_at::text AS "occurredAt"
      FROM publication_review review
      LEFT JOIN internal_user ON internal_user.id = review.reviewer_id
      WHERE review.reviewed_at IS NOT NULL
      ORDER BY review.reviewed_at DESC LIMIT 12
    `,
    sql<GovernanceCount[]>`SELECT verification::text AS label, count(*)::int AS value FROM legal_case GROUP BY verification ORDER BY verification`,
    sql<GovernanceCount[]>`SELECT verification::text AS label, count(*)::int AS value FROM court GROUP BY verification ORDER BY verification`,
    sql<GovernanceCount[]>`SELECT verification::text AS label, count(*)::int AS value FROM entity GROUP BY verification ORDER BY verification`,
    sql<GovernanceCount[]>`
      SELECT CASE
        WHEN extraction_confidence IS NULL THEN 'not measured'
        WHEN extraction_confidence >= 0.95 THEN 'high (95%+)'
        WHEN extraction_confidence >= 0.80 THEN 'moderate (80–94%)'
        ELSE 'low (<80%)' END AS label,
        count(*)::int AS value
      FROM document GROUP BY label ORDER BY label
    `,
    sql<Array<{ value: number }>>`SELECT count(*)::int AS value FROM ingestion_rejection WHERE resolved_at IS NULL`,
    sql<GovernanceDashboard["quality"]["recentRejections"]>`
      SELECT id, reason_code AS "reasonCode", error_message AS message,
        source_uri AS "sourceUri", last_seen_at::text AS "lastSeenAt"
      FROM ingestion_rejection WHERE resolved_at IS NULL
      ORDER BY last_seen_at DESC LIMIT 12
    `,
    sql<Array<{ events: number; explanations: number }>>`
      SELECT count(*)::int AS events,
        count(*) FILTER (WHERE event_type = 'explanation_request')::int AS explanations
      FROM demand_event WHERE occurred_at >= now() - interval '30 days'
    `,
    sql<GovernanceCount[]>`SELECT status::text AS label, count(*)::int AS value FROM enrichment_request GROUP BY status ORDER BY status`,
    sql<Array<{ estimated: number; actual: number }>>`
      SELECT COALESCE(sum(estimated_cost_microusd) FILTER (WHERE status = 'queued'), 0)::float8 AS estimated,
        COALESCE(sum(actual_cost_microusd), 0)::float8 AS actual
      FROM enrichment_request
    `,
    sql<Array<{ awaitingApproval: number; unexecutedActions: number; enabledDefinitions: number }>>`
      SELECT
        (SELECT count(*)::int FROM agent_task WHERE status = 'awaiting_approval') AS "awaitingApproval",
        (SELECT count(*)::int FROM agent_action WHERE approval_required AND executed_at IS NULL) AS "unexecutedActions",
        (SELECT count(*)::int FROM agent_definition WHERE enabled AND retired_at IS NULL) AS "enabledDefinitions"
    `,
    sql<GovernanceCount[]>`
      SELECT status::text AS label, count(*)::int AS value FROM agent_run
      WHERE started_at >= now() - interval '30 days' GROUP BY status ORDER BY status
    `,
    sql<GovernanceDashboard["audit"]>`
      SELECT event.id, event.action, internal_user.email AS actor,
        event.target_type AS "targetType", event.target_id::text AS "targetId",
        event.occurred_at::text AS "occurredAt"
      FROM internal_audit_event event
      LEFT JOIN internal_user ON internal_user.id = event.actor_internal_user_id
      ORDER BY event.occurred_at DESC LIMIT 20
    `,
  ]);

  const publicationValue = (rows: GovernanceCount[], label: string) =>
    rows.find((row) => row.label === label)?.value ?? 0;
  const agent = agentTotals[0];
  const demand = demandTotals[0];
  const costs = enrichmentCosts[0];

  return {
    publication: {
      cases: casePublication,
      documents: documentPublication,
      reviews,
      activeReviewCount: publicationValue(reviews, "pending") + publicationValue(reviews, "in_review") + publicationValue(reviews, "needs_changes"),
      recentDecisions,
    },
    quality: {
      cases: caseVerification,
      courts: courtVerification,
      entities: entityVerification,
      documentConfidence,
      openRejections: rejectionTotal[0]?.value ?? 0,
      recentRejections,
    },
    privacy: {
      suppressedCases: publicationValue(casePublication, "suppressed"),
      restrictedCases: publicationValue(casePublication, "restricted"),
      suppressedDocuments: publicationValue(documentPublication, "suppressed"),
      restrictedDocuments: publicationValue(documentPublication, "restricted"),
    },
    demand: {
      eventsLast30Days: demand?.events ?? 0,
      explanationRequestsLast30Days: demand?.explanations ?? 0,
      enrichmentQueue,
      estimatedQueuedCostMicrousd: costs?.estimated ?? 0,
      actualCostMicrousd: costs?.actual ?? 0,
    },
    agents: {
      awaitingApproval: agent?.awaitingApproval ?? 0,
      unexecutedActions: agent?.unexecutedActions ?? 0,
      enabledDefinitions: agent?.enabledDefinitions ?? 0,
      recentRuns,
    },
    audit,
  };
}
