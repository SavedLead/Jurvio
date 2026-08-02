import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PrivacyQueueItem {
  id: string;
  publicId: string;
  status: string;
  requesterType: string;
  identityStatus: string;
  submittedAt: string;
  assignedTo: string | null;
  targetCount: number;
  proposedActionCount: number;
  highRiskSignalCount: number;
  latestEventAt: string | null;
}

export async function listPrivacyRequests(sql: Sql): Promise<PrivacyQueueItem[]> {
  return sql<PrivacyQueueItem[]>`
    SELECT request.id::text, request.public_id AS "publicId", request.status::text,
      request.requester_type AS "requesterType", request.identity_status::text AS "identityStatus",
      request.submitted_at::text AS "submittedAt", assignee.display_name AS "assignedTo",
      count(DISTINCT target.id)::int AS "targetCount",
      count(DISTINCT action.id) FILTER (WHERE action.status = 'proposed')::int AS "proposedActionCount",
      count(DISTINCT signal.id) FILTER (WHERE signal.severity = 'high')::int AS "highRiskSignalCount",
      max(audit.occurred_at)::text AS "latestEventAt"
    FROM privacy_request request
    LEFT JOIN internal_user assignee ON assignee.id = request.assigned_to
    LEFT JOIN privacy_request_target target ON target.privacy_request_id = request.id
    LEFT JOIN privacy_action action ON action.privacy_request_target_id = target.id
    LEFT JOIN privacy_abuse_signal signal ON signal.privacy_request_id = request.id
    LEFT JOIN privacy_audit_event audit ON audit.privacy_request_id = request.id
    WHERE request.status NOT IN ('closed', 'withdrawn')
    GROUP BY request.id, assignee.display_name
    ORDER BY CASE request.status
      WHEN 'submitted' THEN 0 WHEN 'identity_pending' THEN 1 WHEN 'in_review' THEN 2
      WHEN 'approved' THEN 3 WHEN 'partially_approved' THEN 4 ELSE 5 END,
      request.submitted_at
  `;
}
