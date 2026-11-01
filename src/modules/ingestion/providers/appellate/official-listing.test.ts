import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOfficialAppellateListing } from "./official-opinions";
import { appellateCourtByCode } from "./registry";

const FIXTURES = join(__dirname, "../../live-feeds/fixtures/circuits");
const page = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("appellate-official listing fetch through the adapters", () => {
  it("ca3: reads all three listings with no conditional headers, even when validators are stored", async () => {
    const pages: Record<string, string> = {
      "recopinions.xml": page("ca3-recop.xml"), "recprec.htm": page("ca3-recprec.htm"), "recnonprec.htm": page("ca3-recnonprec.htm"),
    };
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).has("if-none-match")).toBe(false);
      expect(new Headers(init.headers).has("if-modified-since")).toBe(false);
      const name = url.split("/").pop()!;
      return new Response(pages[name], { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const listing = await fetchOfficialAppellateListing(appellateCourtByCode("ca3")!, { etag: "\"stale\"", lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(listing.notModified).toBe(false);
    expect(listing.candidates).toHaveLength(88);
    expect(listing.fetches.map((fetch) => [fetch.label, fetch.httpStatus, fetch.items])).toEqual([
      ["precedential-rss", 200, 11], ["precedential", 200, 11], ["non-precedential", 200, 77],
    ]);
  });

  it("one failing listing is logged and does not drop the others; all failing throws with the log", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("unpub/logname.php") ? new Response("gone", { status: 404 }) : new Response(page("ca11-publog.html"), { status: 200 })));
    const listing = await fetchOfficialAppellateListing(appellateCourtByCode("ca11")!);
    // 20 rows; consolidated appeals share a PDF, and this pipeline keys on the document.
    expect(listing.candidates).toHaveLength(17);
    expect(listing.fetches.map((fetch) => [fetch.ok, fetch.httpStatus])).toEqual([[true, 200], [false, 404]]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const failure = await fetchOfficialAppellateListing(appellateCourtByCode("ca11")!).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as { fetches?: unknown[] }).fetches).toHaveLength(2);
  });
});
