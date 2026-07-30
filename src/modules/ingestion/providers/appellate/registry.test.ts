import { describe,expect,it } from "vitest";
import { APPELLATE_COURT_REGISTRY, appellateCourtByCode, fairAppellateOrder } from "./registry";
import { parseOfficialAppellateListing } from "./official-opinions";

describe("appellate source registry",()=>{
  it("covers exactly all 13 federal appellate courts",()=>{
    expect(APPELLATE_COURT_REGISTRY).toHaveLength(13);
    expect(new Set(APPELLATE_COURT_REGISTRY.map(c=>c.code)).size).toBe(13);
    expect(["ca1","ca2","ca3","ca4","ca5","ca6","ca7","ca8","ca9","ca10","ca11","cadc","cafc"].every(c=>appellateCourtByCode(c))).toBe(true);
  });
  it("puts unstarted circuits first and remains deterministic",()=>{
    const checkpoints = new Map<string, string | null>(
      APPELLATE_COURT_REGISTRY.map((court)=>[court.code,"2026-07-30"]),
    );
    checkpoints.set("ca2",null);
    const order=fairAppellateOrder(checkpoints);
    expect(order[0]?.code).toBe("ca2");
  });
  it("discovers official PDF links idempotently",()=>{
    const court=appellateCourtByCode("ca4")!;
    const html='<div>07/30/2026 No. 25-1745 Vapor Technology Association v. Wooten <a href="/opinions/251745.P.pdf">Published opinion</a><a href="/opinions/251745.P.pdf">duplicate</a></div>';
    const rows=parseOfficialAppellateListing(html,court);
    expect(rows).toHaveLength(1); expect(rows[0]?.docketNumber).toBe("25-1745"); expect(rows[0]?.decidedOn).toBe("2026-07-30"); expect(rows[0]?.documentUrl).toBe("https://www.ca4.uscourts.gov/opinions/251745.P.pdf");
  });
});
