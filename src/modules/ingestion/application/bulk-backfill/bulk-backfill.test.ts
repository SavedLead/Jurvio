import { describe, expect, it } from "vitest";
import {
  evaluateFederalPublicationCandidate,
  isProviderScopedDocketNumber,
} from "../../domain/federal-stream";
import {
  bulkDate,
  bulkDocketNumber,
  bulkOpinionMetadata,
  bulkTimestamp,
  cleanText,
} from "./bulk-values";
import { IdBitset } from "./id-bitset";
import { LoadGovernor } from "./progress";
import { backfillScopeKey } from "./run-federal-backfill";
import { parseSha256Manifest, snapshotMirrorKey } from "./snapshot";

describe("bulk values", () => {
  it("removes characters PostgreSQL text and jsonb reject", () => {
    expect(cleanText("a\u0000b")).toBe("ab");
    expect(cleanText("x\uD800y")).toBe("x�y");
    expect(cleanText("ok 😀")).toBe("ok 😀");
  });

  it("keeps real calendar dates, including the 1700s, and drops impossible ones", () => {
    expect(bulkDate("1789-09-24")).toBe("1789-09-24");
    expect(bulkDate("1799-02-30")).toBeNull();
    expect(bulkDate("0000-01-01")).toBeNull();
    expect(bulkDate("1900-02-29")).toBeNull();
    expect(bulkDate("2024-02-29 00:00:00")).toBe("2024-02-29");
    expect(bulkDate("")).toBeNull();
    expect(bulkTimestamp("2026-09-01 10:00:00.123456+00")).toBe("2026-09-01 10:00:00.123456+00");
    expect(bulkTimestamp("not a time")).toBeNull();
  });

  it("gives unnumbered dockets a provider-scoped key and holds them from publication", () => {
    expect(bulkDocketNumber("77", " 1:20-cv-1 ")).toEqual({ docketNumber: "1:20-cv-1", providerScoped: false });
    const scoped = bulkDocketNumber("77", "  ");
    expect(scoped).toEqual({ docketNumber: "courtlistener-docket-77", providerScoped: true });
    expect(isProviderScopedDocketNumber(scoped.docketNumber)).toBe(true);
    expect(isProviderScopedDocketNumber("21-1234")).toBe(false);
    const decision = evaluateFederalPublicationCandidate({
      caption: "In re Debtor", docketNumber: scoped.docketNumber, courtJurisdiction: "FB",
      courtProviderId: "mab", courtVerification: "verified", sourceArtifactId: "a",
      sourceProviderCode: "courtlistener", sourceRecordId: "x", sourceUri: "https://example.test",
      sourceContentHash: "a".repeat(64), sourceRetrievedAt: "2026-09-30",
      hasReadableContent: true, canonicalIdentifier: "77", canonicalIdentifierCount: 1,
      identityCollisionCount: 1, unresolvedRejections: 0, restrictedText: "In re Debtor",
    });
    expect(decision.reasons).toContain("provider_scoped_docket_number");
  });

  it("keeps opinion metadata but not the text renderings", () => {
    expect(bulkOpinionMetadata({ id: "1", type: "020lead", plain_text: "abc", html: "", xml_harvard: "<x/>" }))
      .toEqual({ id: "1", type: "020lead", text_columns: { plain_text: 3, xml_harvard: 4 } });
  });
});

describe("IdBitset", () => {
  it("tracks ids up to CourtListener scale and defers oversized ids to the database", () => {
    const bitset = new IdBitset(8, 2 ** 32);
    bitset.add("74424942");
    bitset.add(3);
    bitset.add(3);
    expect(bitset.size).toBe(2);
    expect(bitset.mayContain("74424942")).toBe(true);
    expect(bitset.mayContain("74424943")).toBe(false);
    expect(bitset.mayContain(2 ** 40)).toBe(true);
    expect(bitset.mayContain("abc")).toBe(false);
  });
});

describe("LoadGovernor", () => {
  it("pauses for slow batches and stops on signal or deadline", async () => {
    const governor = new LoadGovernor({ targetBatchMs: 1_000, maxPauseMs: 5_000, sizeCheckEvery: 1 });
    expect(governor.pauseAfter(800)).toBe(0);
    expect(governor.pauseAfter(3_000)).toBe(2_000);
    expect(governor.pauseAfter(60_000)).toBe(5_000);
    const unused = {} as never;
    expect(await governor.stopReason(unused)).toBeNull();
    let now = 0;
    const timed = new LoadGovernor({ targetBatchMs: 1, maxPauseMs: 1, deadline: 10, sizeCheckEvery: 99 }, () => false, () => now);
    expect(await timed.stopReason(unused)).toBeNull();
    now = 10;
    expect(await timed.stopReason(unused)).toBe("time_budget");
    const signalled = new LoadGovernor({ targetBatchMs: 1, maxPauseMs: 1, sizeCheckEvery: 99 }, () => true);
    expect(await signalled.stopReason(unused)).toBe("signal");
  });
});

describe("snapshot manifest and scope", () => {
  it("reads sha256sum output and names mirror keys", () => {
    const manifest = parseSha256Manifest(`${"a".repeat(64)}  dockets-2026-09-30.csv.bz2\n${"B".repeat(64)} *opinions-2026-09-30.csv.bz2\nbad line\n`);
    expect(manifest.get("dockets-2026-09-30.csv.bz2")).toBe("a".repeat(64));
    expect(manifest.get("opinions-2026-09-30.csv.bz2")).toBe("b".repeat(64));
    expect(manifest.size).toBe(2);
    expect(snapshotMirrorKey("2026-09-30", "courts-2026-09-30.csv.bz2"))
      .toBe("courtlistener/bulk-mirror/2026-09-30/courts-2026-09-30.csv.bz2");
  });

  it("keeps pilot progress separate from the full run", () => {
    const full = backfillScopeKey({ includeBankruptcy: true, includeScotus: false });
    expect(full).toBe("federal-full");
    const pilot = backfillScopeKey({ includeBankruptcy: true, includeScotus: false, courts: ["mad", "ca1"] });
    expect(pilot).toMatch(/^federal-scoped-[a-f0-9]{12}$/);
    expect(backfillScopeKey({ includeBankruptcy: true, includeScotus: false, courts: ["ca1", "mad"] })).toBe(pilot);
    expect(backfillScopeKey({ includeBankruptcy: false, includeScotus: false })).not.toBe(full);
  });
});
