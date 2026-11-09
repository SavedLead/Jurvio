import { describe, expect, it } from "vitest";
import { ADMINISTRATION_FEED_NOTE, atomFeed, publicFeedItems, type ActivityFeedItem } from "./activity-feed";

const item = (title: string, summary = ""): ActivityFeedItem => ({
  id: "id", title, url: "https://jurvio.com/x", updated: "2026-11-08T00:00:00Z", summary, category: "docket",
});

describe("public Supreme Court feeds", () => {
  it("drops sealed or restricted lines and escapes markup", () => {
    expect(publicFeedItems([item("Ada v. Bay"), item("In re Sealed Case")])).toHaveLength(1);
    const xml = atomFeed({
      id: "urn:jurvio:scotus", title: "All", selfUrl: "https://jurvio.com/feeds/scotus",
      subtitle: "A & B", updated: "2026-11-08T00:00:00Z",
      items: [item("A <b>", "ok")],
    });
    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("A &lt;b&gt;");
    expect(xml).not.toContain("<b>");
  });

  it("labels the administration feed as automatic and approximate", () => {
    expect(ADMINISTRATION_FEED_NOTE).toMatch(/Automatic and approximate/);
    expect(ADMINISTRATION_FEED_NOTE).toMatch(/not a reviewed list/);
  });
});
