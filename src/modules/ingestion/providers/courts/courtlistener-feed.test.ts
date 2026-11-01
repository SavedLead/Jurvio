import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COURTLISTENER_FEED_COURTS, headerDocket, namesOtherDistrict, parseCourtListenerFeed } from "./courtlistener-feed";

// Saved 2026-11-01 from https://www.courtlistener.com/feed/court/{court}/.
const feed = (court: string) => readFileSync(join(__dirname, "../../live-feeds/fixtures/courtlistener", `${court}.atom.xml`), "utf8");

describe("CourtListener per-court opinion feeds", () => {
  it("reads all four saved feeds", () => {
    for (const court of COURTLISTENER_FEED_COURTS) {
      const items = parseCourtListenerFeed(feed(court), court);
      expect(items, court).toHaveLength(20);
      for (const item of items) {
        expect(item.itemKey).toMatch(/^https:\/\/www\.courtlistener\.com\/opinion\/\d+\//);
        expect(item.issuedOn).toMatch(/^2026-10-\d{2}$/);
        expect(item.caption.length).toBeGreaterThan(3);
        expect(item.documentUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it("takes the docket, RECAP document number and date from an entry", () => {
    const [first] = parseCourtListenerFeed(feed("vaed"), "vaed");
    expect(first).toMatchObject({
      opinionId: "11051078", docketNumber: "1:25-cv-01708", docketComplete: true, caption: "Jones v. Phelan",
      issuedOn: "2026-10-30", entryNumber: "21",
      documentUrl: "https://storage.courtlistener.com/recap/gov.uscourts.vaed.583487/gov.uscourts.vaed.583487.21.0.pdf",
      otherCourt: false,
    });
    const oknd = parseCourtListenerFeed(feed("oknd"), "oknd");
    expect(oknd[0]).toMatchObject({ docketNumber: "26-cv-00479", docketComplete: false });
    expect(oknd.filter((item) => item.otherCourt).map((item) => item.caption)).toEqual(["Tenison v. Harding"]);
    const gasd = parseCourtListenerFeed(feed("gasd"), "gasd");
    expect(gasd.find((item) => item.caption.startsWith("Buxton"))).toMatchObject({ docketNumber: "1:26-cv-00005", docketComplete: true });
    expect(gasd.filter((item) => item.otherCourt)).toHaveLength(1);
  });

  it("normalizes header case numbers", () => {
    expect(headerDocket("No. 1:25-cv-01708-MSN-WBP v.")).toEqual({ docket: "1:25-cv-01708", complete: true });
    expect(headerDocket("Civil No. 2:26cv1148 JEFFREY")).toEqual({ docket: "2:26-cv-01148", complete: true });
    expect(headerDocket("Civil Action No. 3:23CV801")).toEqual({ docket: "3:23-cv-00801", complete: true });
    expect(headerDocket("NO. 1:26-CV-103-RPC-DAS")).toEqual({ docket: "1:26-cv-00103", complete: true });
    expect(headerDocket("CV 126-005 * JOHN")).toEqual({ docket: "1:26-cv-00005", complete: true });
    expect(headerDocket("CR418-12")).toEqual({ docket: "4:18-cr-00012", complete: true });
    expect(headerDocket("Case No. 26-CV-0479-CVE-JFJ")).toEqual({ docket: "26-cv-00479", complete: false });
    expect(headerDocket("no case number here")).toBeNull();
  });

  it("flags an opinion filed under the wrong district", () => {
    expect(namesOtherDistrict("UNITED STATES DISTRICT COURT SOUTHERN DISTRICT OF INDIANA", "gasd")).toBe(true);
    expect(namesOtherDistrict("IN THE UNITED STATES DISTRICT COURT FOR THE SOUTHERN DISTRICT OF GEORGIA", "gasd")).toBe(false);
    expect(namesOtherDistrict("Gnited States District Court for the Morthern District of Oklahoma", "oknd")).toBe(false);
  });
});
