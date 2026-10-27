import { describe, expect, it } from "vitest";
import {
  changeFromPublicationEvent,
  PUBLICATION_CHANGED_TOPIC,
  type PublicationOutboxEvent,
  type ResolvedSubject,
} from "./projection";

const subject: ResolvedSubject = { caseRef: "case-1", caseName: "Doe v. Acme Corp." };

const docEvent: PublicationOutboxEvent = {
  topic: PUBLICATION_CHANGED_TOPIC,
  aggregateType: "document",
  aggregateId: "doc-9",
  aggregateVersion: "1700000000000000",
};

describe("changeFromPublicationEvent", () => {
  it("maps a published opinion document to a case-level opinion_published change", () => {
    const change = changeFromPublicationEvent(docEvent, subject);
    expect(change).not.toBeNull();
    expect(change!.subjectType).toBe("case");
    expect(change!.subjectRef).toBe("case-1");
    expect(change!.kind).toBe("opinion_published");
    expect(change!.headline).toContain("Doe v. Acme Corp.");
    expect(change!.sourceLabel).toBe("CourtListener");
  });

  it("produces a stable dedup key that varies with the aggregate version", () => {
    const a = changeFromPublicationEvent(docEvent, subject)!;
    const again = changeFromPublicationEvent({ ...docEvent }, subject)!;
    const newerVersion = changeFromPublicationEvent({ ...docEvent, aggregateVersion: "1700000000000001" }, subject)!;
    expect(a.dedupKey).toBe(again.dedupKey);
    expect(a.dedupKey).not.toBe(newerVersion.dedupKey);
  });

  it("falls back to a generic headline when the case name is unknown", () => {
    const change = changeFromPublicationEvent(docEvent, { caseRef: "case-2", caseName: null })!;
    expect(change.headline).toBe("A new opinion document was published in a case you follow.");
  });

  it("treats a case-level publication change as a status update", () => {
    const change = changeFromPublicationEvent({ ...docEvent, aggregateType: "legal_case", aggregateId: "case-1" }, subject)!;
    expect(change.kind).toBe("status_changed");
  });

  it("ignores non-publication topics", () => {
    expect(changeFromPublicationEvent({ ...docEvent, topic: "something.else" }, subject)).toBeNull();
  });

  it("ignores an event with no resolvable case", () => {
    expect(changeFromPublicationEvent(docEvent, { caseRef: "", caseName: null })).toBeNull();
  });
});
