import { describe, expect, it } from "vitest";
import { CASE_CITATION_REVALIDATE_SECONDS } from "@/modules/citations/application/cached-public-citations";
import { loadRequestPublicCase } from "./load-public-case";

describe("request-scoped public case loader", () => {
  it("does not query for an id that cannot be a case", async () => {
    await expect(loadRequestPublicCase("not-a-case")).resolves.toBeNull();
    await expect(loadRequestPublicCase("../jv-abcdefgh")).resolves.toBeNull();
  });

  it("caches citation lists for fifteen minutes", () => {
    expect(CASE_CITATION_REVALIDATE_SECONDS).toBe(900);
  });
});
