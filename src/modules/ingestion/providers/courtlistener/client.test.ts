import { describe, expect, it } from "vitest";
import {
  courtListenerOpinionOrderBy,
  courtListenerRetryDelayMs,
} from "./client";

describe("CourtListener economical retrieval controls", () => {
  it("maps the bounded corpus priorities to stable API ordering", () => {
    expect(courtListenerOpinionOrderBy("newest")).toBe("-date_filed");
    expect(courtListenerOpinionOrderBy("cited")).toBe("-citation_count,-date_filed");
  });

  it("honors Retry-After while capping provider-requested delays", () => {
    expect(courtListenerRetryDelayMs("5", 1)).toBe(5_000);
    expect(courtListenerRetryDelayMs("120", 1)).toBe(60_000);
  });

  it("uses bounded exponential backoff when Retry-After is unavailable", () => {
    expect(courtListenerRetryDelayMs(null, 1)).toBe(1_000);
    expect(courtListenerRetryDelayMs("invalid", 3)).toBe(4_000);
  });
});
