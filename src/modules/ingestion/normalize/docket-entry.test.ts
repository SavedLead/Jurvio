import { describe, expect, it } from "vitest";
import { courtListenerDocketEntrySchema } from "../providers/courtlistener/schema";
import { normalizeCourtListenerDocketEntry } from "./docket-entry";

describe("CourtListener docket-entry normalization", () => {
  it("preserves an entry and its nested document identities", () => {
    const source = courtListenerDocketEntrySchema.parse({
      id: 91,
      resource_uri: "/api/rest/v4/docket-entries/91/",
      docket: "/api/rest/v4/dockets/123/",
      docket_id: 123,
      date_filed: "2026-01-12",
      entry_number: 17,
      description: " ORDER granting motion. ",
      recap_documents: [{
        id: 501,
        resource_uri: "/api/rest/v4/recap-documents/501/",
        document_number: "17",
        attachment_number: null,
        pacer_doc_id: "123017",
        description: "Order",
        document_type: "PACER Document",
        page_count: 4,
        is_available: true,
        filepath_local: "/recap/gov.uscourts.example.123017.pdf",
      }],
    });

    expect(normalizeCourtListenerDocketEntry(source)).toEqual({
      sourceEntryId: "91",
      sourceUri: "/api/rest/v4/docket-entries/91/",
      entryNumber: "17",
      filedOn: "2026-01-12",
      description: "ORDER granting motion.",
      documents: [{
        sourceDocumentId: "501",
        sourceUri: "/api/rest/v4/recap-documents/501/",
        documentNumber: "17",
        attachmentNumber: undefined,
        pacerDocumentId: "123017",
        description: "Order",
        documentType: "PACER Document",
        pageCount: 4,
        isAvailable: true,
        sourceFilePath: "/recap/gov.uscourts.example.123017.pdf",
      }],
    });
  });

  it("rejects an empty entry rather than publishing a thin row", () => {
    const source = courtListenerDocketEntrySchema.parse({
      id: 92,
      resource_uri: "/api/rest/v4/docket-entries/92/",
      docket: "/api/rest/v4/dockets/123/",
      description: "",
      recap_documents: [],
    });

    expect(() => normalizeCourtListenerDocketEntry(source)).toThrow(
      "no useful public content",
    );
  });
});
