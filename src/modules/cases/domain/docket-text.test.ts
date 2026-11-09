import { describe, expect, it } from "vitest";
import { plainDocketText } from "./docket-text";

describe("plain docket text", () => {
  it("drops feed markup and keeps the court's words", () => {
    expect(plainDocketText("[Summons Issued] (<a href=\"https://ecf.example/doc1/1\">4</a>)"))
      .toBe("[Summons Issued] ( 4 )");
    expect(plainDocketText("Order &amp;amp; judgment")).toBe("Order & judgment");
  });
});
