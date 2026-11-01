import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./follow-case-box.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./follow-case-box.css", import.meta.url), "utf8");

describe("Follow this case box", () => {
  it("links the free-limit line, the follow counter and the limit prompt to /pricing", () => {
    expect(source).toMatch(/Free for up to \{FREE_FOLLOW_LIMIT\} cases\. <Link className="followPlansLink" href=\{"\/pricing" as Route\}>See plans<\/Link>/);
    expect(source.match(/href=\{"\/pricing" as Route\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('state.error === "limit_reached" ? <p className="followUpgrade" role="alert">');
  });

  it("keeps the box clear of the sticky header when scrolled to (#follow)", () => {
    expect(css).toMatch(/\.followCaseBox \{ scroll-margin-top: \d+px;/);
  });
});
