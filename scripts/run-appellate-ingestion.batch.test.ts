import { beforeAll, describe, expect, it } from "vitest";

// The script module builds a postgres client at import time (`const sql = db()`),
// which parses the env schema. postgres.js connects lazily, so a syntactically valid
// URL plus a user-agent is enough to import the module without touching a database.
// The ingestion loop itself is guarded behind an entry-point check, so importing here
// exercises only the pure batch-assembly helpers.
type Module = typeof import("./run-appellate-ingestion");
let mod: Module;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/jurvio_test";
  process.env.INGESTION_USER_AGENT ??= "vitest appellate ingestion agent";
  mod = await import("./run-appellate-ingestion");
});

type PlanArg = Parameters<Module["planNeedsCreation"]>[0];
type ExistingMatch = NonNullable<PlanArg["existingMatch"]>;

function makeExistingMatch(overrides: Partial<ExistingMatch> = {}): ExistingMatch {
  return {
    case_id: "case-existing",
    case_public_id: "case_pub_existing",
    case_publication: "published",
    court_id: "court-existing",
    court_name: "United States Court of Appeals for the First Circuit",
    provider_id: "provider-official",
    document_id: "doc-existing",
    cluster_id: "cluster-existing",
    document_publication: "published",
    title: "Existing v. Match opinion",
    caption: "Existing v. Match",
    decided_on: "2026-01-02",
    opinion_type: "majority",
    precedential_status: "Published",
    citation_count: 3,
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanArg> = {}): PlanArg {
  return {
    item: {
      id: "item-1",
      court_code: "ca9",
      docketNumber: "25-1234",
      caption: "Alpha v. Beta",
      decidedOn: "2026-08-01",
    },
    providerId: "provider-official",
    courtName: "United States Court of Appeals for the Ninth Circuit",
    courtShortName: "9 Cir.",
    existingMatch: null,
    documentUrl: "https://cdn.ca9.uscourts.gov/opinions/25-1234.pdf",
    pdfHash: "hash-aaa",
    objectKey: "official-appellate/ca9/hash-aaa.pdf",
    textHash: "text-aaa",
    html: "<p>Body</p>",
    normalizedText: "Body of the opinion.",
    wordCount: 321,
    ...overrides,
  } as PlanArg;
}

describe("appellate batched-write assembly", () => {
  it("keys the source record id as court_code:pdfHash", () => {
    const plan = makePlan({ item: { ...makePlan().item, court_code: "ca9" }, pdfHash: "abc123" });
    expect(mod.appellateSourceRecordId(plan)).toBe("ca9:abc123");
  });

  it("treats a plan without a resolved document+cluster match as needing creation", () => {
    expect(mod.planNeedsCreation(makePlan({ existingMatch: null }))).toBe(true);
    expect(mod.planNeedsCreation(makePlan({
      existingMatch: makeExistingMatch({ cluster_id: null }),
    }))).toBe(true);
    expect(mod.planNeedsCreation(makePlan({
      existingMatch: makeExistingMatch({ document_id: null }),
    }))).toBe(true);
    expect(mod.planNeedsCreation(makePlan({
      existingMatch: makeExistingMatch(),
    }))).toBe(false);
  });

  it("collapses plans that share a court to one insert row while keeping distinct clusters", () => {
    const planA = makePlan({ item: { ...makePlan().item, id: "a", docketNumber: "25-1" }, pdfHash: "h1" });
    const planB = makePlan({ item: { ...makePlan().item, id: "b", docketNumber: "25-2" }, pdfHash: "h2" });
    // Same provider + court_code -> same court natural key.
    expect(mod.batchKeys.court(planA)).toBe(mod.batchKeys.court(planB));
    expect(mod.dedupeLast([planA, planB], mod.batchKeys.court)).toHaveLength(1);
    // Distinct pdf hashes -> distinct cluster + opinion + document-identifier keys.
    expect(mod.batchKeys.cluster(planA)).not.toBe(mod.batchKeys.cluster(planB));
    expect(mod.dedupeLast([planA, planB], mod.batchKeys.cluster)).toHaveLength(2);
  });

  it("dedupeLast keeps the last occurrence of a key", () => {
    const first = makePlan({ item: { ...makePlan().item, id: "first" } });
    const second = makePlan({ item: { ...makePlan().item, id: "second" } });
    // Both share the same court key; last one wins.
    const [kept] = mod.dedupeLast([first, second], mod.batchKeys.court);
    expect(kept?.item.id).toBe("second");
  });

  it("indexBy builds a lookup keyed by the returned natural key", () => {
    const rows = [
      { provider_id: "p", provider_court_id: "ca9", id: "court-9" },
      { provider_id: "p", provider_court_id: "ca1", id: "court-1" },
    ];
    const map = mod.indexBy(rows, (r) => `${r.provider_id} ${r.provider_court_id}`);
    expect(map.get("p ca9")?.id).toBe("court-9");
    expect(map.get("p ca1")?.id).toBe("court-1");
  });

  it("threads resolved graph ids and the resolved caption into the created canonical", () => {
    const plan = makePlan();
    const ids: Parameters<Module["createdCanonical"]>[1] = {
      courtId: "court-new",
      courtName: "United States Court of Appeals for the Ninth Circuit",
      caseId: "case-new",
      casePublicId: "case_pub_new",
      // Resolved caption from the legal_case upsert RETURNING (may differ from plan caption).
      caseCaption: "Alpha Corp. v. Beta LLC",
      caseDecidedOn: "2026-08-01",
      casePublication: "published",
      clusterId: "cluster-new",
      documentId: "doc-new",
    };
    const canonical = mod.createdCanonical(plan, ids);
    expect(canonical.court_id).toBe("court-new");
    expect(canonical.case_id).toBe("case-new");
    expect(canonical.cluster_id).toBe("cluster-new");
    expect(canonical.document_id).toBe("doc-new");
    expect(canonical.case_public_id).toBe("case_pub_new");
    expect(canonical.caption).toBe("Alpha Corp. v. Beta LLC");
    // Title derives from the RESOLVED caption, matching the per-item path's use of legalCase.caption.
    expect(canonical.title).toBe("Alpha Corp. v. Beta LLC opinion");
    expect(canonical.opinion_type).toBe("majority");
    expect(canonical.citation_count).toBe(0);
    expect(canonical.precedential_status).toBeNull();
    expect(canonical.document_publication).toBe("published");
    expect(canonical.decided_on).toBe("2026-08-01");

    const tail = mod.tailValues(plan, canonical);
    expect(tail).toMatchObject({
      itemId: "item-1",
      documentId: "doc-new",
      caseId: "case-new",
      courtId: "court-new",
      clusterId: "cluster-new",
      casePublicId: "case_pub_new",
      caption: "Alpha Corp. v. Beta LLC",
      title: "Alpha Corp. v. Beta LLC opinion",
      opinionType: "majority",
      citationCount: 0,
      decidedOn: "2026-08-01",
    });
  });

  it("resolves an existing-match plan from its canonical fields with per-item fallbacks", () => {
    const match = makeExistingMatch({ title: null, opinion_type: null, citation_count: null });
    const plan = makePlan({ existingMatch: match });
    const canonical = mod.existingCanonical(match);
    expect(canonical.document_id).toBe("doc-existing");
    expect(canonical.cluster_id).toBe("cluster-existing");

    const tail = mod.tailValues(plan, canonical);
    // Null title -> `${caption} opinion`; null opinion_type -> 'majority'; null count -> 0.
    expect(tail.title).toBe("Existing v. Match opinion");
    expect(tail.opinionType).toBe("majority");
    expect(tail.citationCount).toBe(0);
    expect(tail.documentId).toBe("doc-existing");
    expect(tail.caseId).toBe("case-existing");
    expect(tail.courtId).toBe("court-existing");
    expect(tail.clusterId).toBe("cluster-existing");
  });

  it("refuses to resolve a canonical from an incomplete match", () => {
    expect(() => mod.existingCanonical(makeExistingMatch({ cluster_id: null }))).toThrow();
    expect(() => mod.existingCanonical(makeExistingMatch({ document_id: null }))).toThrow();
  });

  it("builds the outbox payload with the official-appellate provenance shape", () => {
    const plan = makePlan({ pdfHash: "hash-xyz", wordCount: 999 });
    expect(JSON.parse(mod.outboxPayload(plan))).toEqual({
      source: "official_appellate",
      courtCode: "ca9",
      docketNumber: "25-1234",
      sourceHash: "hash-xyz",
      extractionMethod: "native_pdf_text",
      wordCount: 999,
    });
  });
});
