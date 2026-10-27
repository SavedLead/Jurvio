// Milestone M4, Phase B (ADR 0077): monitoring domain types and the change-event dedup key.
//
// A watch is a principal following a subject (an entity or a saved search). A change_event is a
// derived record that "something happened" on a subject; alerts fan out from change_events to the
// watchers of that subject. The projection that writes change_events (off the ingestion outbox +
// deterministic status transitions) lives in a later Phase B increment; this module is the shared,
// pure vocabulary both sides use.

import type { AlertCadence } from "@/modules/accounts/domain/entitlements";

export const WATCH_TARGET_TYPES = [
  "case",
  "party",
  "organization",
  "attorney",
  "law_firm",
  "judge",
  "court",
  "topic",
  "saved_search",
] as const;

export type WatchTargetType = (typeof WATCH_TARGET_TYPES)[number];

export function isWatchTargetType(value: string): value is WatchTargetType {
  return (WATCH_TARGET_TYPES as readonly string[]).includes(value);
}

export interface Watch {
  id: string;
  principalId: string;
  targetType: WatchTargetType;
  targetRef: string;
  label: string | null;
  cadence: AlertCadence;
  muted: boolean;
}

// The meaningful, user-facing kinds of change we alert on. Deliberately NOT a raw docket-entry
// feed (docs/18 §4: raw notifications are not sufficient differentiation); each kind maps to a
// readable, sourced summary.
export type ChangeKind =
  | "status_changed"
  | "opinion_published"
  | "document_published"
  | "judgment_entered"
  | "appeal_filed"
  | "case_reopened"
  | "case_stayed";

export interface ChangeEvent {
  subjectType: WatchTargetType;
  subjectRef: string;
  kind: ChangeKind;
  headline: string;
  occurredOn: string | null;
  sourceLabel: string | null;
  ruleVersion: string | null;
}

/**
 * Stable idempotency key for a change_event. Deterministic in the underlying court record, so
 * re-running the projection never writes a duplicate alert for the same event (the `dedup_key`
 * column is UNIQUE). `sourceKey` identifies the originating record (e.g. the opinion/docket-entry
 * id or a status event id).
 */
export function changeEventDedupKey(input: {
  subjectType: WatchTargetType;
  subjectRef: string;
  kind: ChangeKind;
  sourceKey: string;
}): string {
  return [input.subjectType, input.subjectRef, input.kind, input.sourceKey].join("|");
}
