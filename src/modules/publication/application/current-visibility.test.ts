import { describe, expect, it } from "vitest";
import { latestPublicationColumnSql } from "./current-visibility";

describe("latestPublicationColumnSql", () => {
  it("reads displayable from publication_current and falls back to the latest decision", () => {
    const sql = latestPublicationColumnSql("displayable", "legal_case", "c.id");
    expect(sql).toContain("FROM publication_current current_row");
    expect(sql).toContain("current_row.object_type = 'legal_case' AND current_row.object_id = c.id");
    expect(sql).toContain("ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1");
    expect(sql.startsWith("COALESCE(")).toBe(true);
  });

  it("reads indexable from the decision the mirror points at", () => {
    const sql = latestPublicationColumnSql("indexable", "document", "document.id");
    expect(sql).toContain("JOIN publication_decision decision ON decision.id = current_row.decision_id");
    expect(sql).toContain("decision.indexable");
    expect(sql).toContain("current_row.object_id = document.id");
  });

  it("rejects identifiers that are not a column reference", () => {
    expect(() => latestPublicationColumnSql("displayable", "legal_case", "c.id; drop table legal_case")).toThrow(/id expression/);
    expect(() => latestPublicationColumnSql("displayable", "not_a_type", "c.id")).toThrow(/object type/);
  });
});
