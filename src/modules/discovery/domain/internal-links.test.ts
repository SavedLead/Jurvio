import { describe, expect, it } from "vitest";
import { internalAppPaths, opinionPathWould404 } from "./internal-links";

const hub = `
  <a href="/supreme-court/emergency">Emergency</a>
  <a href="/feeds/scotus/administration">Admin</a>
  <a href="https://jurvio.com/case/jv-nlorv068wz">Mullin</a>
  <a href="/case/jv-nlorv068wz/documents/jd-igmi9rwamk">Opinion</a>
  <a href="https://www.supremecourt.gov/opinions/26pdf/26a560_onkq.pdf">Official PDF</a>
  <a href="/case/jv-nlorv068wz/documents/not-an-id">Bad</a>
  <a href="#recent-opinions">Skip</a>
`;

describe("internal link crawl", () => {
  it("collects Jurvio paths and ignores official PDFs and in-page anchors", () => {
    expect(internalAppPaths(hub)).toEqual([
      "/supreme-court/emergency",
      "/feeds/scotus/administration",
      "/case/jv-nlorv068wz",
      "/case/jv-nlorv068wz/documents/jd-igmi9rwamk",
      "/case/jv-nlorv068wz/documents/not-an-id",
    ]);
  });

  it("fails a hub that links an opinion id the reader would 404", () => {
    const paths = internalAppPaths(hub);
    expect(paths.filter(opinionPathWould404)).toEqual(["/case/jv-nlorv068wz/documents/not-an-id"]);
    expect(paths.filter((path) => path.startsWith("/case/") && !opinionPathWould404).every((path) =>
      /^\/case\/jv-[a-z0-9]{8,10}(?:\/(?:docket|parties|documents|timeline|summary))?(?:\/documents\/jd-[a-z0-9]{8,10})?$/.test(path)
      || /^\/case\/jv-[a-z0-9]{8,10}\/documents\/jd-[a-z0-9]{8,10}$/.test(path),
    )).toBe(true);
  });
});
