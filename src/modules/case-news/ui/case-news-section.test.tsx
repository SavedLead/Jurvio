import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseNewsSection, formatNewsDate } from "./case-news-section";

// Vitest compiles JSX with the classic runtime here; Next uses the automatic one.
(globalThis as { React?: typeof React }).React = React;

const link = {
  id: "1", url: "https://www.reuters.com/legal/x", outlet: "Reuters", title: "Ninth Circuit upholds Seattle law challenged by Uber",
  snippet: "A panel rejected the challenge.", publishedAt: "2026-10-20 18:15:00+00", source: "gdelt",
};

describe("CaseNewsSection", () => {
  it("renders nothing when there is no coverage", () => {
    expect(renderToStaticMarkup(<CaseNewsSection links={[]} />)).toBe("");
  });
  it("shows only headline, snippet and a link to the source, with nofollow ugc and GDELT credit", () => {
    const html = renderToStaticMarkup(<CaseNewsSection links={[link]} />);
    expect(html).toContain("In the news");
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(html).toContain("Ninth Circuit upholds Seattle law challenged by Uber");
    expect(html).toContain("A panel rejected the challenge.");
    expect(html).toContain("Read at Reuters");
    expect(html).not.toContain("Oct 20, 2026");
    expect(html).not.toContain("<time");
    expect(html).toContain("gdeltproject.org");
  });
  it("formats Postgres timestamps", () => {
    expect(formatNewsDate("2026-10-20 23:59:00+00")).toBe("Oct 20, 2026");
  });
});
