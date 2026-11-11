import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/bulk-publish-complete-drafts.sh", "utf8");
const workflow = readFileSync(".github/workflows/bulk-publish-complete-drafts-once.yml", "utf8");
const catchUp = readFileSync("scripts/catch-up-published-search.sh", "utf8");
const catchUpWorkflow = readFileSync(".github/workflows/catch-up-published-search-once.yml", "utf8");

describe("bulk publish of complete drafts", () => {
  it("publishes only complete non-thin drafts and leaves the alert clock alone", () => {
    expect(script).toContain("length(btrim(windowed.caption)) > 0");
    expect(script).toContain("length(btrim(windowed.docket_number)) > 0");
    expect(script).toContain("windowed.filed_on IS NOT NULL");
    expect(script).toContain("judge_case_assignment");
    expect(script).toContain("party_appearance");
    expect(script).toContain("docket_entry");
    expect(script).toContain("cause_of_action");
    expect(script).toContain("nature_of_suit_code");
    expect(script).toContain("<> 'scotus'");
    expect(script).toContain("updated_at = c.updated_at");
    expect(script).toContain("SELECT set_config('jurvio.defer_search_refresh', 'on', true);");
    expect(script).not.toContain("DO $$");
    expect(script).toContain("grep -E '^[0-9]+\\|[0-9]+$'");
    expect(script).toContain("SET LOCAL statement_timeout = '10min';");
    expect(script).toContain(") || true");
    expect(script).toContain("reducing range to $RANGE and retrying the same checkpoint");
    expect(script).toContain("retrying range $RANGE after a timeout");
    expect(script).toContain("public_case_search");
    expect(script).not.toContain("ON CONFLICT (case_id) DO NOTHING");
    expect(script).not.toContain("catch_up_search_slice");
    expect(catchUp).toContain("ON CONFLICT (case_id) DO NOTHING");
    expect(script).not.toContain("legal_case.updated_at = now()");
    expect(script).toContain("restricted_or_sensitive");
    expect(script).toContain("RANGE=200000");
    expect(script).not.toMatch(/entity_alert|sleep /);
  });

  it("is a manual ingestion-host job with a count mode and a publish mode", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("BULK_PUBLISH_COUNT");
    expect(workflow).toContain("BULK_PUBLISH_RUN");
    expect(workflow).toContain("10.116.0.2");
    expect(workflow).toContain("timeout-minutes: 2880");
    expect(workflow).not.toContain("timeout-minutes: 360");
    expect(workflow).not.toContain("sudo");
    expect(script).toContain("resuming from bulk_publish_cursor");
    expect(script).toContain("bulk publish ended without completing");
    expect(script).toContain("ORDER BY c.created_at DESC, c.id DESC");
    expect(script).toContain("legal_case_draft_created_idx");
    expect(script).toContain("c.created_at < params.created_at");
    expect(script).toContain("c.publication = 'draft'");
    expect(script).toContain("</dev/null");
  });

  it("catches the text index up outside the publish transaction and leaves alerts alone", () => {
    expect(catchUp).toContain("public_case_search");
    expect(catchUp).toContain("ON CONFLICT (case_id) DO NOTHING");
    expect(catchUp).toContain("search_catchup_cursor");
    expect(catchUp).toContain("passed_dates");
    expect(catchUp).toContain("DESC NULLS LAST, c.caption, c.id");
    expect(catchUp).toContain("ORDER BY ev.last_seen_at DESC, ev.id DESC");
    expect(catchUp).toContain("NOT EXISTS (SELECT 1 FROM public_case_search search WHERE search.case_id = batch.id)");
    expect(catchUp).toContain("lock_timeout = '3s'");
    expect(catchUp).toContain("updated_at = c.updated_at");
    expect(catchUp).toContain("updated_at = entry.updated_at");
    expect(catchUp).toContain("WHEN r.court_code IN ('cand', 'caed', 'cacd', 'casd', 'ord', 'waed', 'wawd', 'nvd') THEN 'America/Los_Angeles'");
    expect(catchUp).toContain("recent.filed_on = min(entry.filed_on) + 1");
    expect(catchUp).toContain("future sort dates before");
    expect(catchUp).toContain("WHEN c.filed_on > (SELECT day FROM today) THEN chosen.entry_day");
    expect(catchUp).toContain("updated_at = c.updated_at");
    expect(catchUp).toContain("COALESCE(c.decided_on, c.filed_on) > state.cursor_date");
    expect(catchUp).toContain("COALESCE(c.decided_on, c.filed_on) < state.cursor_date");
    expect(catchUp).toContain("LIMIT :batch_size");
    expect(catchUp).toContain("batch_size=500");
    expect(catchUp).toContain("batch_size=250");
    expect(catchUp).toContain("batch_size=100");
    expect(catchUp).toContain("catch-up waiting ${stall_wait}s after repeated failures at 100");
    expect(catchUp).toContain("stalled_for=$((stalled_for + stall_wait))");
    expect(catchUp).toContain("stall_wait=$((stall_wait * 2))");
    expect(catchUp).toContain("stall_wait=${CATCHUP_STALL_WAIT:-300}");
    expect(catchUp).toContain("stall_wait_cap=${CATCHUP_STALL_WAIT_CAP:-1800}");
    expect(catchUp).toContain("stall_limit=${CATCHUP_STALL_LIMIT:-10800}");
    expect(catchUp).toContain('if [ "$stalled_for" -ge "$stall_limit" ]; then');
    expect(catchUp).toContain("catch-up stopped after ${stalled_for}s without a committed batch");
    const stall = catchUp.slice(catchUp.indexOf('if [ "$small_failures" -ge 3 ]; then'));
    expect(stall.indexOf("catch-up stopped after")).toBeLessThan(stall.indexOf("catch-up waiting"));
    expect(stall.indexOf("catch-up waiting")).toBeLessThan(stall.indexOf('sleep "$stall_wait"'));
    expect(catchUp).toContain("stalled_for=0");
    expect(catchUp).toContain("entry.provider_entry_id = windowed.deduplication_key");
    expect(readFileSync("db/migrations/0205_catchup_date_correction_index.sql", "utf8")).toContain(
      "docket_entry_case_provider_entry_idx",
    );
    expect(catchUp).not.toContain("interval '3 days'");
    expect(catchUp).not.toContain("batches\" -lt 2000");
    expect(catchUp).not.toContain("legal_case.updated_at = now()");
    expect(catchUpWorkflow).toContain("timeout-minutes: 2880");
    expect(catchUpWorkflow).not.toContain("timeout-minutes: 120");
    expect(catchUpWorkflow).toContain("workflow_dispatch:");
    expect(catchUpWorkflow).toContain("CATCH_UP_PUBLISHED_SEARCH");
    expect(catchUpWorkflow).toContain("10.116.0.2");
    expect(catchUpWorkflow).not.toContain("push:");
    expect(catchUpWorkflow).toContain("DB_HOST: 10.116.0.2");
    expect(catchUpWorkflow).not.toContain("WEB_HOST");
    expect(catchUpWorkflow.toLowerCase()).not.toContain("google.com");
    expect(catchUp.toLowerCase()).not.toContain("google.com");
    expect(catchUp.toLowerCase()).not.toContain("webmasters");
  });
});
