import { describe, expect, it } from "vitest";
import { conditionalRequestHeaders } from "./http-validators";

describe("conditional HTTP validators", () => {
  it("sends If-None-Match and If-Modified-Since only when stored", () => {
    expect(conditionalRequestHeaders({ etag: 'W/"abc"', lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" })).toEqual({
      "If-None-Match": 'W/"abc"',
      "If-Modified-Since": "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(conditionalRequestHeaders({ etag: "  ", lastModified: null })).toEqual({});
    expect(conditionalRequestHeaders(null)).toEqual({});
  });
});
