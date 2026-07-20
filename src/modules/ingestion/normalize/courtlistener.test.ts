import { describe, expect, it } from "vitest";
import { normalizeCourtListenerDocket } from "./courtlistener";
import { courtListenerDocketSchema } from "../providers/courtlistener/schema";

describe("CourtListener normalization", () => {
  it("normalizes stable case metadata without inventing missing values", () => {
    const source = courtListenerDocketSchema.parse({
      id: 4214664,
      resource_uri: "/api/rest/v4/dockets/4214664/",
      absolute_url: "/docket/4214664/example/",
      docket_number: "1:25-cv-01482",
      case_name: "Acme Technologies, Inc. v. Rivera",
      case_name_short: "Acme v. Rivera",
      case_name_full: null,
      date_filed: "2025-04-03",
      date_terminated: null,
      cause: "28:1332 Diversity",
      nature_of_suit: "190 Contract",
      jury_demand: "Both",
      assigned_to_str: "Jessica L. Clarke",
      referred_to_str: "",
      court: "/api/rest/v4/courts/nysd/",
      date_modified: "2026-06-18T15:30:00Z",
    });

    expect(normalizeCourtListenerDocket(source)).toEqual({
      sourceCaseId: "4214664",
      sourceCourtUri: "/api/rest/v4/courts/nysd/",
      sourceUri: "/docket/4214664/example/",
      docketNumber: "1:25-cv-01482",
      caption: "Acme Technologies, Inc. v. Rivera",
      shortCaption: "Acme v. Rivera",
      filedOn: "2025-04-03",
      terminatedOn: undefined,
      sourceUpdatedAt: "2026-06-18T15:30:00.000Z",
      natureOfSuit: "190 Contract",
      causeOfAction: "28:1332 Diversity",
      assignedJudge: "Jessica L. Clarke",
      referredJudge: undefined,
    });
  });
});
