import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { docketKey, usReportsKey } from "../domain/scdb";
import { DOCKET_KEY_SQL, US_KEY_SQL } from "./scdb-matching";
import { importJusticeRoster, importScdbRelease, matchScdbToJurvio, refreshScotusAnalytics, type RosterJustice } from "./import-scdb";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}

const COLUMNS = ["caseId", "docketId", "caseIssuesId", "voteId", "dateDecision", "decisionType", "usCite", "sctCite", "ledCite", "lexisCite",
  "term", "naturalCourt", "chief", "docket", "caseName", "dateArgument", "dateRearg", "issue", "issueArea", "decisionDirection",
  "decisionDirectionDissent", "caseDisposition", "partyWinning", "precedentAlteration", "declarationUncon", "majOpinWriter",
  "majOpinAssigner", "splitVote", "majVotes", "minVotes", "justice", "justiceName", "vote", "opinion", "direction", "majority",
  "firstAgreement", "secondAgreement"];

type Vote = [justice: number, vote: string, majority: string, direction: string];
function csv(cases: { id: string; docket: string; us: string; date: string; type: string; dir: string; maj: string; min: string; votes: Vote[] }[]) {
  const lines = [COLUMNS.map((c) => `"${c}"`).join(",")];
  for (const c of cases) {
    for (const [justice, vote, majority, direction] of c.votes) {
      const row: Record<string, string> = {
        caseId: c.id, docketId: `${c.id}-01`, caseIssuesId: `${c.id}-01-01`, voteId: `${c.id}-01-01-01-0${justice}`,
        dateDecision: c.date, decisionType: c.type, usCite: c.us, term: "2190", docket: c.docket, caseName: `FIXTURE ${c.id}`,
        issueArea: "2", decisionDirection: c.dir, majOpinWriter: "901", majVotes: c.maj, minVotes: c.min,
        justice: String(justice), justiceName: `J${justice}`, vote, opinion: "1", direction, majority, firstAgreement: "0", secondAgreement: "",
      };
      lines.push(COLUMNS.map((col) => `"${row[col] ?? ""}"`).join(","));
    }
  }
  return Buffer.from(lines.join("\r\n") + "\r\n");
}

const roster: RosterJustice[] = [901, 902, 903, 904].map((id) => ({
  scdbJusticeId: id, scdbCode: `FIX${id}`, scdbName: `Fixture, ${id}`, scdbServiceStart: "2180-10-01", scdbServiceEnd: null,
  fjcNid: `fixture-${id}`, fullName: `Fixture Justice ${id}`, birthDate: null, birthYear: null, birthPlace: null,
  deathDate: null, deathYear: null, deathPlace: null,
  appointments: [{ fjcSequence: 1, appointmentTitle: "Associate Justice", appointingPresident: "Fixture President",
    nominationDate: null, confirmationDate: null, commissionDate: "2180-09-30", recessAppointmentDate: null,
    senateVoteType: null, senateVote: null, terminationReason: null, terminationDate: null }],
}));

describe.skipIf(!databaseUrl)("SCDB import, Jurvio matching and justice analytics", () => {
  it("imports votes, links cases by citation and docket+date, refuses ambiguous links, and precomputes analytics", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const db = tx as never;
        await importJusticeRoster(db, { justices: roster }, { path: "fixture/justices.json", bytes: Buffer.from("{}") });

        const justiceFile = csv([
          { id: "2190-001", docket: "90-1", us: "900 U.S. 1", date: "3/1/2191", type: "1", dir: "2", maj: "3", min: "1",
            votes: [[901, "1", "2", "2"], [902, "1", "2", "2"], [903, "3", "2", "2"], [904, "2", "1", "1"]] },
          { id: "2190-002", docket: "90-2", us: "", date: "4/1/2191", type: "2", dir: "1", maj: "3", min: "1",
            votes: [[901, "1", "2", "1"], [902, "1", "2", "1"], [903, "2", "1", "2"], [904, "1", "2", "1"]] },
          { id: "2190-003", docket: "90-3", us: "", date: "5/1/2191", type: "1", dir: "3", maj: "5", min: "4",
            votes: [[901, "1", "2", ""], [902, "1", "2", ""], [903, "2", "1", ""], [904, "2", "1", ""]] },
        ]);
        const docketFile = Buffer.from([
          "caseId,docketId,docket,caseName,usCite,dateDecision",
          "2190-001,2190-001-01,90-1,FIXTURE 2190-001,900 U.S. 1,3/1/2191",
          "2190-001,2190-001-02,90-11,FIXTURE CONSOLIDATED,900 U.S. 1,3/1/2191",
        ].join("\n"));
        const imported = await importScdbRelease(db, {
          era: "modern", version: "fixture", sourceUrl: "https://example.test/scdb",
          justiceFile: { path: "fixture/justice.csv", bytes: justiceFile }, docketFile: { path: "fixture/docket.csv", bytes: docketFile },
        });
        expect(imported).toMatchObject({ cases: 3, dockets: 4, votes: 12, skippedVotes: 0, encoding: "utf-8" });

        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court (public_id, name, verification) VALUES ('jc-scdbfix', 'SCDB Fixture Court', 'verified') RETURNING id`;
        const addCase = async (publicId: string, docket: string, citation: string | null, decidedOn: string | null) => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case (public_id, court_id, docket_number, caption, decided_on, supreme_court_term, official_citation)
            VALUES (${publicId}, ${court!.id}, ${docket}, ${publicId}, ${decidedOn}, 2190, ${citation}) RETURNING id`;
          return row!.id;
        };
        const byCite = await addCase("jv-scdbfix1", "No. 90-1", "900 U.S. 1 (2191)", "2191-03-01");
        const byDocketDate = await addCase("jv-scdbfix2", "90-2", null, "2191-04-01");
        await addCase("jv-scdbfix3a", "90-3", "901 U.S. 1", null);
        await addCase("jv-scdbfix3b", "90-3", "902 U.S. 1", null);

        // The SQL keys used for matching agree with the TypeScript helpers.
        for (const value of ["No. 25-748", "25-748", "Nos. 22-451, 22-1219", "22O141", "141, Orig."]) {
          const [row] = await tx.unsafe<{ k: string | null }[]>(`SELECT ${DOCKET_KEY_SQL("$1::text")} AS k`, [value]);
          expect(row!.k).toBe(docketKey(value));
        }
        for (const value of ["410 U.S. 113", "603 U.S. 369 (2024)", "146 S. Ct. 1873", "5 U.S. 137"]) {
          const [row] = await tx.unsafe<{ k: string | null }[]>(`SELECT ${US_KEY_SQL("$1::text")} AS k`, [value]);
          expect(row!.k).toBe(usReportsKey(value));
        }

        await matchScdbToJurvio(db);
        const links = await tx<{ scdb_case_id: string; legal_case_id: string | null; match_method: string | null; match_candidates: number | null }[]>`
          SELECT scdb_case_id, legal_case_id, match_method, match_candidates FROM scdb_case WHERE term = 2190 ORDER BY 1`;
        expect(links).toEqual([
          { scdb_case_id: "2190-001", legal_case_id: byCite, match_method: "us_cite", match_candidates: 1 },
          { scdb_case_id: "2190-002", legal_case_id: byDocketDate, match_method: "docket_and_date", match_candidates: 1 },
          { scdb_case_id: "2190-003", legal_case_id: null, match_method: null, match_candidates: 2 },
        ]);
        const [consolidated] = await tx<{ legal_case_id: string; match_method: string }[]>`
          SELECT legal_case_id, match_method FROM scdb_case_docket WHERE scdb_docket_id = '2190-001-02'`;
        expect(consolidated).toEqual({ legal_case_id: byCite, match_method: "us_cite" });

        await refreshScotusAnalytics(db);
        const pairs = await tx<{ scope: string; justice_a: number; justice_b: number; cases_together: number; cases_agreed: number; agreement_rate: string }[]>`
          SELECT scope, justice_a, justice_b, cases_together, cases_agreed, agreement_rate::text
          FROM scotus_justice_pair_agreement_mv WHERE term_key = 2190 AND justice_a >= 901 ORDER BY scope, justice_a, justice_b`;
        const all = Object.fromEntries(pairs.filter((p) => p.scope === "all").map((p) => [`${p.justice_a}-${p.justice_b}`, [p.cases_agreed, p.cases_together]]));
        expect(all).toEqual({ "901-902": [3, 3], "901-903": [1, 3], "901-904": [1, 3], "902-903": [1, 3], "902-904": [1, 3], "903-904": [1, 3] });
        const argued = pairs.find((p) => p.scope === "argued" && p.justice_a === 901 && p.justice_b === 903);
        expect(argued).toMatchObject({ cases_together: 2, cases_agreed: 1, agreement_rate: "0.5000" });

        const [ledger] = await tx<{ cases_both_on_record: number; cases_excluded: number; votes_without_direction: number; votes_participating: number }[]>`
          SELECT p.cases_both_on_record, p.cases_excluded, d.votes_without_direction, d.votes_participating
          FROM scotus_justice_pair_agreement_mv p
          JOIN scotus_justice_direction_mv d ON d.scope = 'all' AND d.scdb_justice_id = 901 AND d.term_key = 2190 AND d.issue_area_key = 0
          WHERE p.scope = 'all' AND p.term_key = 2190 AND p.justice_a = 901 AND p.justice_b = 902`;
        expect(ledger).toEqual({ cases_both_on_record: 3, cases_excluded: 0, votes_without_direction: 1, votes_participating: 3 });

        const [coverage] = await tx<{ scdb_cases: number; argued_cases: number; cases_with_direction: number; five_four_cases: number; cases_linked_to_jurvio: number }[]>`
          SELECT scdb_cases, argued_cases, cases_with_direction, five_four_cases, cases_linked_to_jurvio FROM scotus_term_coverage_v WHERE term = 2190`;
        expect(coverage).toEqual({ scdb_cases: 3, argued_cases: 2, cases_with_direction: 2, five_four_cases: 1, cases_linked_to_jurvio: 2 });

        const [unusual] = await tx<{ scdb_case_id: string; justice_a: number; justice_b: number; lowest_majority_pair_term_agreement: string }[]>`
          SELECT scdb_case_id, justice_a, justice_b, lowest_majority_pair_term_agreement::text FROM scotus_unusual_alignment_v WHERE term = 2190`;
        expect(unusual).toEqual({ scdb_case_id: "2190-003", justice_a: 901, justice_b: 902, lowest_majority_pair_term_agreement: "1.0000" });

        const direction = await tx<{ scdb_justice_id: number; votes_with_direction: number; scdb_liberal_share: string }[]>`
          SELECT scdb_justice_id, votes_with_direction, scdb_liberal_share::text FROM scotus_justice_direction_mv
          WHERE scope = 'all' AND term_key = 2190 AND issue_area_key = 0 AND scdb_justice_id >= 901 ORDER BY 1`;
        expect(direction).toEqual([
          { scdb_justice_id: 901, votes_with_direction: 2, scdb_liberal_share: "0.5000" },
          { scdb_justice_id: 902, votes_with_direction: 2, scdb_liberal_share: "0.5000" },
          { scdb_justice_id: 903, votes_with_direction: 2, scdb_liberal_share: "1.0000" },
          { scdb_justice_id: 904, votes_with_direction: 2, scdb_liberal_share: "0.0000" },
        ]);

        const fiveFour = await tx<{ scdb_case_id: string; majority_coalition: string[]; dissenting_coalition: string[] }[]>`
          SELECT scdb_case_id, majority_coalition, dissenting_coalition FROM scotus_five_four_decision_v WHERE term = 2190`;
        expect(fiveFour).toEqual([{ scdb_case_id: "2190-003", majority_coalition: ["FIX901", "FIX902"], dissenting_coalition: ["FIX903", "FIX904"] }]);

        const [breakdown] = await tx<{ vote_split: string; majority_opinion_writer: string; scdb_decision_direction_label: string; votes: { code: string; voteLabel: string; scdbDirectionLabel: string; firstAgreement: number | null }[] }[]>`
          SELECT vote_split, majority_opinion_writer, scdb_decision_direction_label, votes FROM scotus_case_vote_breakdown_v WHERE scdb_case_id = '2190-001'`;
        expect(breakdown).toMatchObject({ vote_split: "3-1", majority_opinion_writer: "Fixture Justice 901", scdb_decision_direction_label: "liberal" });
        expect(breakdown!.votes.map((v) => [v.code, v.voteLabel, v.scdbDirectionLabel, v.firstAgreement])).toEqual([
          ["FIX901", "voted with majority or plurality", "liberal", null],
          ["FIX902", "voted with majority or plurality", "liberal", null],
          ["FIX903", "regular concurrence", "liberal", null],
          ["FIX904", "dissent", "conservative", null],
        ]);

        const [release] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM scotus_dataset_release WHERE version = 'fixture' AND sha256 ~ '^[0-9a-f]{64}$'`;
        expect(release!.n).toBe(2);
        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  }, 60_000);
});
