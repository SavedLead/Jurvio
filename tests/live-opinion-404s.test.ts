import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getExplainer } from "@/modules/explainers/domain/explainers";

/**
 * Linked from the homepage, /supreme-court, and /supreme-court/emergency.
 * Live check 8:24 PM ET on 2026-11-09: each of these returned 404.
 * The opinion paths must render (official PDF when text is not extracted).
 * /explainers/certiorari must render the writ-of-certiorari explainer.
 */
const LIVE_404S = [
  "/case/jv-aogzw1s1xh/documents/jd-rzij2jh39p",
  "/case/jv-d7meisx90o/documents/jd-r6p0fpuip4",
  "/case/jv-lc0sdyz9p3/documents/jd-fiy13rib02",
  "/case/jv-nlorv068wz/documents/jd-igmi9rwamk",
  "/case/jv-v3pemdk8x0/documents/jd-oxjai06r9z",
  "/case/jv-vtlo8a3s31/documents/jd-f9nj8tso5b",
  "/case/jv-yjfghlvygl/documents/jd-e7pevozqar",
  "/explainers/certiorari",
] as const;

const OPINION_PATH = /^\/case\/jv-[a-z0-9]{8,10}\/documents\/jd-[a-z0-9]{8,10}$/;

describe("the eight live 404s from 2026-11-09", () => {
  const reader = readFileSync("src/modules/cases/application/get-public-opinion.ts", "utf8");
  const page = readFileSync("src/app/case/[caseId]/documents/[documentId]/page.tsx", "utf8");
  const hub = readFileSync("src/app/supreme-court/page.tsx", "utf8");

  it("lists those eight URLs and no others", () => {
    expect(LIVE_404S).toHaveLength(8);
    expect(LIVE_404S.filter((path) => path.startsWith("/case/"))).toHaveLength(7);
    expect(LIVE_404S).toContain("/explainers/certiorari");
  });

  it("opens each opinion path without requiring extracted text, and shows the official PDF", () => {
    expect(reader).toContain("LEFT JOIN document_content content ON content.document_id = document.id");
    expect(page).toContain("viewableOpinionPdf");
    expect(page).toContain("Official PDF");
    expect(page).toContain("<iframe");
    for (const path of LIVE_404S) {
      if (!path.startsWith("/case/")) continue;
      expect(path, path).toMatch(OPINION_PATH);
    }
  });

  it("serves /explainers/certiorari and points the hub at the same explainer", () => {
    expect(getExplainer("certiorari")?.slug).toBe("writ-of-certiorari");
    expect(getExplainer("writ-of-certiorari")?.term).toBe("Writ of certiorari");
    expect(hub).toContain('slug="writ-of-certiorari"');
    expect(hub).not.toContain('slug="certiorari"');
  });
});
