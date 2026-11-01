import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Workflow status used to be posted as comments on issue #426 (and as a new
// issue per run). GitHub emails the issue author for every one of those, so a
// single deploy or backup sent several emails. Status belongs in the run:
// $GITHUB_STEP_SUMMARY and ::notice::/::warning:: annotations.
//
// Workflows may still EDIT a handful of pre-existing report comments
// (PATCH /issues/comments/ID, which sends no notification); only those need
// `issues: write`.

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");
const files = readdirSync(WORKFLOW_DIR).filter((file) => /\.ya?ml$/.test(file));
const code = (file: string) =>
  readFileSync(join(WORKFLOW_DIR, file), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

/** Workflows that edit existing report comments in place (no new comments, no emails). */
const EDITS_REPORT_COMMENTS = new Set([
  "federal-ingestion.yml",
  "ingest-production-scotus-official.yml",
  "ingest-production-scotus-pre502.yml",
  "publish-official-scotus-opinions.yml",
  "watch-scotus-assembly.yml",
]);

describe("workflows never create issues or issue/PR comments", () => {
  it("finds the workflow files", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const file of EDITS_REPORT_COMMENTS) expect(files).toContain(file);
  });

  it.each(files)("%s creates no issue or comment", (file) => {
    const text = code(file);
    expect(text).not.toMatch(/gh (issue|pr) (comment|create)\b/);
    expect(text).not.toMatch(/issues\/[^"\s]*\/comments/);
    expect(text).not.toMatch(/POST "?(https:\/\/api\.github\.com\/)?repos\/\$GITHUB_REPOSITORY\/issues"?/);
    expect(text).not.toMatch(/createComment|issues\.create\b|create-or-update-comment/);
    expect(text).not.toMatch(/\bgh_issue_create\b/);
    expect(text).not.toMatch(/\bgh_comment\s+\d+/);
  });

  it.each(files)("%s only asks for issues: write when it edits report comments", (file) => {
    const wantsIssues = /^\s*issues:\s*write\s*$/m.test(code(file));
    expect(wantsIssues, `${file}: drop issues: write`).toBe(EDITS_REPORT_COMMENTS.has(file));
  });

  it("the public deploy reports progress in the run, not on issue #426", () => {
    const text = code("deploy-public-web-hosted.yml");
    expect(text).toContain("GITHUB_STEP_SUMMARY");
    expect(text).not.toMatch(/issues\/426/);
  });
});
