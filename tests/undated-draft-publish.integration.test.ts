import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicCases } from "@/modules/cases/application/list-public-cases";
import { listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { listCaseSitemapRecords } from "@/modules/discovery/application/sitemaps";
import { buildRecordAnswers } from "@/modules/cases/domain/record-answers";
import { dateOnOrBeforeToday } from "@/lib/time/calendar-date";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}

describe.skipIf(!databaseUrl)("undated party-less draft publication", () => {
  it("publishes without a filed date or parties, renders no date, and counts once", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const suffix = Math.random().toString(36).slice(2, 8);
    try {
      await client.begin(async (tx) => {
        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court (public_id, name, verification, provider_court_id)
          VALUES (${`jc-undated-${suffix}`}, 'Undated District', 'verified', ${`undated${suffix}`})
          RETURNING id
        `;
        const insert = async (publicId: string, caption: string, docket: string, filedOn: string | null) => {
          const [row] = await tx<{ id: string; updated_at: string }[]>`
            INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${publicId}, ${court!.id}, ${docket}, ${caption}, ${filedOn}, 'draft')
            RETURNING id, updated_at::text
          `;
          return row!;
        };
        const undated = await insert(`jv-undt${suffix}`, "Ada v. Baker", `1:20-cv-${suffix}`, null);
        const dated = await insert(`jv-date${suffix}`, "Cara v. Dale", `1:21-cv-${suffix}`, "2020-01-02");
        const sealed = await insert(`jv-seal${suffix}`, "Sealed v. Secret", `1:22-cv-${suffix}`, null);
        const blank = await insert(`jv-blank${suffix}`, "   ", `1:23-cv-${suffix}`, null);

        const publish = async (id: string) => {
          const updated = await tx<{ id: string }[]>`
            UPDATE legal_case AS c
            SET verification = 'verified', publication = 'published', updated_at = c.updated_at
            FROM court
            WHERE c.court_id = court.id
              AND c.id = ${id}
              AND c.publication = 'draft'
              AND lower(coalesce(court.provider_court_id, '')) <> 'scotus'
              AND length(btrim(c.caption)) > 0
              AND length(btrim(c.docket_number)) > 0
              AND NOT (concat_ws(' ', c.caption, c.docket_number) ~* '\\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\\M')
              AND NOT EXISTS (
                SELECT 1 FROM federal_publication_hold hold
                WHERE hold.case_id = c.id
                  AND hold.rule_version = 'federal-publication-v3'
                  AND NOT (cardinality(hold.reasons) > 0 AND hold.reasons <@ ARRAY[
                    'missing_readable_content','unverified_court_record','missing_source_artifact',
                    'missing_source_url','invalid_source_checksum','missing_retrieval_timestamp'
                  ]::text[])
              )
            RETURNING c.id
          `;
          if (!updated[0]) return false;
          const [decision] = await tx<{ id: string; decided_at: string }[]>`
            INSERT INTO publication_decision (
              object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version
            )
            VALUES ('legal_case', ${id}, true, false, true, false, false, 'bulk_complete_draft', 'federal-publication-v3')
            RETURNING id, decided_at::text
          `;
          await tx`
            INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
            VALUES ('legal_case', ${id}, true, ${decision!.decided_at}, ${decision!.id})
            ON CONFLICT (object_type, object_id) DO UPDATE SET
              displayable = EXCLUDED.displayable,
              decided_at = EXCLUDED.decided_at,
              decision_id = EXCLUDED.decision_id
          `;
          return true;
        };

        expect(await publish(undated.id)).toBe(true);
        expect(await publish(dated.id)).toBe(true);
        expect(await publish(sealed.id)).toBe(false);
        expect(await publish(blank.id)).toBe(false);

        const [clock] = await tx<{ updated_at: string; publication: string }[]>`
          SELECT updated_at::text, publication FROM legal_case WHERE id = ${undated.id}
        `;
        expect(clock?.publication).toBe("published");
        expect(clock?.updated_at).toBe(undated.updated_at);

        const loaded = await getPublicCase(tx as unknown as Parameters<typeof getPublicCase>[0], `jv-undt${suffix}`);
        expect(loaded).not.toBeNull();
        expect(loaded?.filedOn).toBeNull();
        expect(loaded?.decidedOn).toBeNull();
        expect(dateOnOrBeforeToday(null)).toBeNull();
        expect(await listPublicParties(tx as unknown as Parameters<typeof listPublicParties>[0], `jv-undt${suffix}`)).toEqual([]);
        const answers = buildRecordAnswers({
          caption: loaded!.caption,
          docketNumber: loaded!.docketNumber,
          courtName: loaded!.courtName,
          courtKind: loaded!.courtKind ?? "other",
          filedOn: loaded!.filedOn,
          decidedOn: loaded!.decidedOn,
          terminatedOn: loaded!.terminatedOn ?? null,
          natureOfSuit: loaded!.natureOfSuit ?? null,
          causeOfAction: loaded!.causeOfAction ?? null,
          docketEntryCount: 0,
          citedByCount: 0,
          hasReadableOpinion: loaded!.hasReadableOpinion,
          opinionFiledOn: null,
          captionCategory: loaded!.captionCategory,
        });
        expect(answers.happened).not.toMatch(/filed on/i);
        expect(answers.happened).not.toMatch(/\b(?:19|20)\d{2}\b/);

        const listed = await listPublicCases(tx as unknown as Parameters<typeof listPublicCases>[0], {
          page: 1,
          pageSize: 10,
          court: `jc-undated-${suffix}`,
          sort: "recent",
        });
        const ids = listed.cases.map((row) => row.publicId);
        expect(ids.indexOf(`jv-date${suffix}`)).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf(`jv-undt${suffix}`)).toBeGreaterThan(ids.indexOf(`jv-date${suffix}`));
        expect(listed.cases.find((row) => row.publicId === `jv-undt${suffix}`)?.filedOn).toBeNull();

        const sitemap = await listCaseSitemapRecords(tx as unknown as Parameters<typeof listCaseSitemapRecords>[0], "jv-", null);
        expect(Array.isArray(sitemap)).toBe(true);
        expect(sitemap.some((row) => row.path === `/case/jv-undt${suffix}`)).toBe(false);

        const [counter] = await tx<{ case_count: number }[]>`
          SELECT case_count FROM court_public_stats WHERE court_id = ${court!.id}
        `;
        expect(counter?.case_count).toBe(2);

        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  });
});
