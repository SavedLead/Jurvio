// Milestone M4, Phase B (ADR 0077): map a publication outbox event to a monitoring change event.
//
// Publishing already emits `publication.changed` rows into outbox_event (see
// src/modules/ingestion/application/publish-federal-opinion-documents.ts). The monitoring
// projection turns those into change_event rows that alerts fan out from. This module is the pure
// mapping core; the DB read/join/persist wiring (resolve the document's case, insert with the
// UNIQUE dedup_key) is the following increment and reuses the ResolvedSubject this produces.

import { changeEventDedupKey, type ChangeEvent, type ChangeKind } from "./monitoring";

export const PUBLICATION_CHANGED_TOPIC = "publication.changed";

export interface PublicationOutboxEvent {
  topic: string;
  aggregateType: "legal_case" | "document";
  aggregateId: string;
  // bigint serialized as a string; part of the dedup source key so each distinct publish maps to
  // its own change event.
  aggregateVersion: string;
  occurredOn?: string | null;
}

// The subject a change belongs to, resolved from the aggregate. Watchers follow the CASE, so a
// document-level event is attributed to its case.
export interface ResolvedSubject {
  caseRef: string;
  caseName: string | null;
}

function headline(kind: ChangeKind, caseName: string | null): string {
  const named = caseName && caseName.trim().length > 0 ? caseName.trim() : null;
  switch (kind) {
    case "opinion_published":
      return named
        ? `A new opinion document was published in ${named}.`
        : "A new opinion document was published in a case you follow.";
    case "status_changed":
    default:
      return named
        ? `${named} was updated on Jurvio.`
        : "A case you follow was updated on Jurvio.";
  }
}

/**
 * Map one publication outbox event to a monitoring ChangeEvent, or null when it is not an
 * alertable publication event. Deterministic; the returned dedup key makes persistence idempotent.
 */
export function changeFromPublicationEvent(
  event: PublicationOutboxEvent,
  subject: ResolvedSubject,
): (ChangeEvent & { dedupKey: string }) | null {
  if (event.topic !== PUBLICATION_CHANGED_TOPIC) return null;
  if (!subject.caseRef) return null;

  // A published federal opinion document means a new readable opinion is now available on the
  // case; a case-level publication change is a broader case update.
  const kind: ChangeKind = event.aggregateType === "document" ? "opinion_published" : "status_changed";

  const change: ChangeEvent = {
    subjectType: "case",
    subjectRef: subject.caseRef,
    kind,
    headline: headline(kind, subject.caseName),
    occurredOn: event.occurredOn ?? null,
    sourceLabel: "CourtListener",
    ruleVersion: null,
  };

  const dedupKey = changeEventDedupKey({
    subjectType: change.subjectType,
    subjectRef: change.subjectRef,
    kind: change.kind,
    sourceKey: `${event.aggregateType}:${event.aggregateId}:${event.aggregateVersion}`,
  });

  return { ...change, dedupKey };
}
