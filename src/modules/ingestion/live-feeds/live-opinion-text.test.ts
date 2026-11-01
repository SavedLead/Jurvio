import { describe, expect, it } from "vitest";
import { HostPacer, countWords, normalizeExtractedText, textLooksNative, trailingUrl } from "./live-opinion-text";

describe("live opinion text helpers", () => {
  it("reads the trailing URL from coa feed descriptions", () => {
    expect(trailingUrl("Published opinion: https://www.ca3.uscourts.gov/opinarch/241234p.pdf")).toBe("https://www.ca3.uscourts.gov/opinarch/241234p.pdf");
    expect(trailingUrl("Opinion filed")).toBeNull();
  });

  it("detects scanned PDFs by words per page", () => {
    const words = Array.from({ length: 400 }, () => "court").join(" ");
    expect(textLooksNative(words, 5)).toBe(true);
    expect(textLooksNative(words, 20)).toBe(false);
    expect(textLooksNative("a b c", 1)).toBe(false);
    expect(countWords("The 3 courts ruled, e.g. x")).toBe(3);
    expect(normalizeExtractedText("a  \r\n\n\n\nb\fc")).toBe("a\n\nb\n\nc");
  });

  it("paces requests per host", async () => {
    let clock = 0;
    const waits: number[] = [];
    const pacer = new HostPacer(1000, async (ms) => { waits.push(ms); clock += ms; }, () => clock);
    await pacer.wait("https://a.test/1");
    await pacer.wait("https://b.test/1");
    clock += 200;
    await pacer.wait("https://a.test/2");
    expect(waits).toEqual([800]);
  });
});
