import type postgres from "postgres";

type Sql=ReturnType<typeof postgres>;
export interface CaseStatusReviewItem {id:string;casePublicId:string;caption:string;docketNumber:string;reasonCode:string;detail:string;ruleVersion:string;status:string;eventType:string|null;sourceUri:string|null;createdAt:string;assignedTo:string|null;}

export async function listCaseStatusReviews(sql:Sql):Promise<CaseStatusReviewItem[]>{return sql<CaseStatusReviewItem[]>`
  SELECT review.id::text, legal_case.public_id AS "casePublicId", legal_case.caption, legal_case.docket_number AS "docketNumber",
    review.reason_code AS "reasonCode", review.detail, review.rule_version AS "ruleVersion", review.status,
    event.event_type AS "eventType", artifact.source_uri AS "sourceUri", review.created_at::text AS "createdAt",
    assignee.display_name AS "assignedTo"
  FROM case_status_review review JOIN legal_case ON legal_case.id=review.case_id
  LEFT JOIN case_status_event event ON event.id=review.status_event_id
  LEFT JOIN raw_artifact artifact ON artifact.id=event.source_artifact_id
  LEFT JOIN internal_user assignee ON assignee.id=review.assigned_to
  WHERE review.status IN ('pending','in_review') ORDER BY review.created_at`}

export async function resolveCaseStatusReview(sql:Sql,input:{reviewId:string;reviewerId:string;decision:"confirmed"|"rule_change_required"|"dismissed";notes:string}){
  if(!input.notes.trim())throw new Error("Reviewer notes are required");
  await sql.begin(async tx=>{
    const [review]=await tx<Array<{caseId:string;priorStatus:string}>>`SELECT case_id::text AS "caseId",status AS "priorStatus" FROM case_status_review WHERE id=${input.reviewId} FOR UPDATE`;
    if(!review||!["pending","in_review"].includes(review.priorStatus))throw new Error("Open case status review not found");
    await tx`UPDATE case_status_review SET status=${input.decision},reviewed_by=${input.reviewerId},reviewer_notes=${input.notes.trim()},reviewed_at=now() WHERE id=${input.reviewId}`;
    await tx`INSERT INTO internal_audit_event(actor_internal_user_id,action,target_type,target_id,metadata) VALUES(${input.reviewerId},'case_status_review_resolved','legal_case',${review.caseId},${tx.json({reviewId:input.reviewId,decision:input.decision,priorStatus:review.priorStatus,notes:input.notes.trim()})})`;
  });
}
