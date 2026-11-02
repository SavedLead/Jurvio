import { describe, expect, it } from "vitest";
import { parseQuestionsPresented, questionsPresentedUrlFor, readQuestionsPresentedUrl } from "./question-presented";

const LOPER = `22-451 LOPER BRIGHT ENTERPRISES V. RAIMONDO
DECISION BELOW: 45 F.4th 359
LOWER COURT CASE NUMBER: 21-5166

QUESTION PRESENTED:

       The Magnuson-Stevens Act (MSA) governs fishery management in federal waters
and provides that the National Marine Fisheries Service (NMFS) may require vessels to
"carry" federal observers onboard.
      The questions presented are:
       1.  Whether, under a proper application of Chevron, the MSA implicitly grants
NMFS the power to force domestic vessels to pay the salaries of the monitors they must
carry.
       2.      Whether the Court should overrule Chevron or at least clarify that
statutory silence concerning controversial powers expressly but narrowly granted
elsewhere in the statute does not constitute an ambiguity requiring deference to the
agency.

THE PETITION FOR A WRIT OF CERTIORARI IS GRANTED LIMITED TO QUESTION
2 PRESENTED BY THE PETITION.
JUSTICE JACKSON TOOK NO PART IN THE CONSIDERATION OR DECISION OF
THIS PETITION AND THESE MOTIONS.

CERT. GRANTED 5/1/2023
`;

describe("questions presented", () => {
  it("splits numbered questions and reads a limited grant", () => {
    const parsed = parseQuestionsPresented(LOPER);
    expect(parsed?.questions).toHaveLength(2);
    expect(parsed?.questions[0]).toMatch(/^Whether, under a proper application of Chevron, the MSA implicitly grants NMFS/);
    expect(parsed?.questions[1]).toMatch(/requiring deference to the agency\.$/);
    expect(parsed?.grantedLimitedTo).toEqual([2]);
  });

  it("keeps a single unnumbered question whole", () => {
    const parsed = parseQuestionsPresented("21-1 X V. Y\nQUESTION PRESENTED:\nWhether a State may tax the income of a nonresident.\n\nCERT. GRANTED 1/1/2022");
    expect(parsed).toEqual({ questions: ["Whether a State may tax the income of a nonresident."], grantedLimitedTo: null, grantedQuestion: null });
  });

  it("keeps the Court's own rewording of a limited grant and drops clerk notes", () => {
    const parsed = parseQuestionsPresented(`QUESTION PRESENTED:
The questions presented are:
1. Whether applying a law to compel an artist to speak violates the Free Speech or Free Exercise Clauses.
2. Whether this Court should overrule Smith.
GRANTED LIMITED TO THE FOLLOWING QUESTION: WHETHER APPLYING A
LAW TO COMPEL AN ARTIST TO SPEAK VIOLATES THE FREE SPEECH CLAUSE.
CERT. GRANTED 2/22/2022`);
    expect(parsed?.questions).toHaveLength(2);
    expect(parsed?.questions[1]).toBe("Whether this Court should overrule Smith.");
    expect(parsed?.grantedQuestion).toBe("WHETHER APPLYING A LAW TO COMPEL AN ARTIST TO SPEAK VIOLATES THE FREE SPEECH CLAUSE.");
    const sffa = parseQuestionsPresented("QUESTION PRESENTED:\n1. Should this Court overrule Grutter?\n2. Title VI bans race-based admissions. Is Harvard violating Title VI?\nCONSOLIDATED WITH 21-707 FOR ONE HOUR ORAL ARGUMENT.\nCERT. GRANTED 1/24/2022");
    expect(sffa?.questions).toEqual(["Should this Court overrule Grutter?", "Title VI bans race-based admissions. Is Harvard violating Title VI?"]);
  });

  it("returns null without a questions-presented heading", () => {
    expect(parseQuestionsPresented("ORDER LIST")).toBeNull();
  });

  it("reads the QP link from a docket page", () => {
    expect(readQuestionsPresentedUrl('<a href="../qp/22-00451qp.pdf">Questions Presented</a>')).toBe("https://www.supremecourt.gov/qp/22-00451qp.pdf");
    expect(readQuestionsPresentedUrl('<a href="https://evil.example/qp/22-00451qp.pdf">x</a>')).toBeNull();
    expect(readQuestionsPresentedUrl("<p>none</p>")).toBeNull();
    expect(questionsPresentedUrlFor("12-398")).toBe("https://www.supremecourt.gov/qp/12-00398qp.pdf");
    expect(questionsPresentedUrlFor("23A100")).toBeNull();
  });
});
