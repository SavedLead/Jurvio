import { describe, expect, it } from "vitest";
import { courtListenerPartySchema } from "../providers/courtlistener/schema";
import { normalizeCourtListenerParty } from "./party";

describe("CourtListener party normalization", () => {
  it("keeps source identity separate while normalizing the filed name", () => {
    const source = courtListenerPartySchema.parse({
      id: 42,
      resource_uri: "/api/rest/v4/parties/42/",
      name: "  John   Smith  ",
      party_types: [
        { docket_id: 123, name: "Defendant", date_terminated: null },
        { docket_id: 456, name: "Plaintiff", date_terminated: null },
      ],
      attorneys: [],
    });

    expect(normalizeCourtListenerParty(source, 123)).toEqual({
      sourcePartyId: "42",
      sourceUri: "/api/rest/v4/parties/42/",
      displayName: "John Smith",
      normalizedName: "john smith",
      roles: [
        {
          role: "Defendant",
          endedOn: undefined,
          nameAsFiled: "John Smith",
        },
      ],
    });
  });

  it("rejects a party that has no role in the requested docket", () => {
    const source = courtListenerPartySchema.parse({
      id: 42,
      resource_uri: "/api/rest/v4/parties/42/",
      name: "John Smith",
      party_types: [{ docket_id: 456, name: "Plaintiff" }],
    });

    expect(() => normalizeCourtListenerParty(source, 123)).toThrow(
      "no role for the requested docket",
    );
  });
});
