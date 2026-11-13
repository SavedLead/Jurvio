import { describe, expect, it } from "vitest";
import { initialsFor, redactNames } from "./redact-names";

const mavash = { fullName: "Mavash Morady", initials: "M.M." };
const paul = { fullName: "Paul Morady", initials: "P.M." };

describe("name redaction", () => {
  it("builds initials from the given name and surname", () => {
    expect(initialsFor("Mavash Morady")).toBe("M.M.");
    expect(initialsFor("paul morady")).toBe("P.M.");
  });

  it("replaces the full name, surname-first form, a middle initial, and a possessive", () => {
    const input = [
      "Mavash Morady appeared.",
      "mavash morady's claim.",
      "Morady, Mavash was named.",
      "Mavash M. Morady signed.",
      "Morady, Mavash M. objected.",
      "Paul Morady's brief.",
      "Morady, Paul filed.",
    ].join(" ");
    const result = redactNames(input, [mavash, paul]);
    expect(result.changed).toBe(true);
    expect(result.text).toContain("M.M. appeared.");
    expect(result.text).toContain("M.M.'s claim.");
    expect(result.text).toContain("M.M. was named.");
    expect(result.text).toContain("M.M. signed.");
    expect(result.text).toContain("M.M. objected.");
    expect(result.text).toContain("P.M.'s brief.");
    expect(result.text).toContain("P.M. filed.");
    expect(result.text.toLowerCase()).not.toContain("mavash");
    expect(result.text.toLowerCase()).not.toContain("paul morady");
  });

  it("leaves a different surname and the surrounding record alone", () => {
    const result = redactNames("Ohio National Life Assurance v. Douglas W. Davis", [mavash]);
    expect(result.changed).toBe(false);
    expect(result.text).toContain("Douglas W. Davis");
  });
});
