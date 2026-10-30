import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

// Merging PR #543 started about ten push-triggered workflows on main. One
// power-cycled the database droplet and another restarted Postgres. This test
// keeps that from happening again:
//
// 1. Only the workflows in AUTO_TRIGGERS may have push, pull_request,
//    workflow_run or schedule triggers, and only the events listed for them.
// 2. Every workflow that is not in READ_ONLY can change production, so it must
//    have a required `confirm` input that every job checks before it does
//    anything (first step, or the job's `if:`). A run without the typed
//    keyword fails closed.
// 3. No job may use a GitHub-hosted (paid) runner, apart from the three
//    builder-recovery workflows that must work when builder-01 is down.
//
// Adding a workflow: it is dispatch-only and needs a confirm gate unless you
// add it to READ_ONLY after checking it only reads.

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");
const AUTOMATIC_EVENTS = ["push", "pull_request", "pull_request_target", "workflow_run", "schedule"] as const;

/** The only workflows allowed to start without a person dispatching them. */
const AUTO_TRIGGERS: Record<string, readonly string[]> = {
  // Tests and lint.
  "ci.yml": ["pull_request", "push"],
  // Merge-to-main deploy of the public web app (plus its migrations), after CI passes.
  "deploy-public-web-hosted.yml": ["workflow_run"],
  // Read-only monitors.
  "disk-alarm.yml": ["schedule"],
  "lane-watchdog.yml": ["schedule"],
  // pg_dump reads production; the dump goes to the backup bucket.
  "nightly-db-backup.yml": ["schedule"],
  // Google Search Console API only; never touches the droplets or the database.
  "google-search-console-sync.yml": ["schedule"],
  // Approved maintenance exceptions (David Rosenberg). They change production
  // on their original schedules; manual runs still need confirm.
  "outbox-maintenance.yml": ["schedule"],
  "verify-backup-restore.yml": ["schedule"],
};

/** Scheduled workflows whose confirm gate must skip schedule events (and only those). */
const SCHEDULED_WITH_CONFIRM = new Set(["lane-watchdog.yml", "outbox-maintenance.yml", "verify-backup-restore.yml"]);

/** Workflows checked to only read. Everything else must have a confirm gate. */
const READ_ONLY = new Set([
  "ci.yml",
  "disk-alarm.yml",
  "nightly-db-backup.yml",
  "google-search-console-sync.yml",
  "citation-link-report-once.yml",
  "diagnose-db-load-once.yml",
  "diagnose-federal-chunk-progress-once.yml",
  "diagnose-federal-court-universe-once.yml",
  "diagnose-federal-eligibility-once.yml",
  "diagnose-federal-holds-once.yml",
  "diagnose-federal-write-perf-once.yml",
  "diagnose-ingestion-disk-once.yml",
  "diagnose-ingestion-lanes-once.yml",
  "diagnose-migration-state-once.yml",
  "diagnose-public-traffic-once.yml",
  "diagnose-publication-and-citation-once.yml",
  "diagnose-publication-gate-once.yml",
  "diagnose-recent-publications-once.yml",
  "fleet-status.yml",
  "ingestion-status.yml",
  "judge-autopilot-status.yml",
  "measure-box-pressure-once.yml",
  "monitor-federal-pipeline-once.yml",
  "operator-audit.yml",
  "post-resize-verify-once.yml",
  "probe-old-volume-once.yml",
  "reconcile-federal-pilot-once.yml",
  "scout-brmag-source-once.yml",
  "scout-cl-bulk-people-once.yml",
  "scout-courtlistener-people-once.yml",
  "scout-runner-provisioning-once.yml",
  "scout-uscourts-vacancies-once.yml",
  "sizing-measure-once.yml",
  "verify-article-i-once.yml",
  "verify-federal-import-once.yml",
  "verify-published-federal-pages-once.yml",
  "verify-spaces-and-ingestion-once.yml",
  "verify-spaces-trace.yml",
]);

/** Must stay on GitHub-hosted runners: they repair builder-01 itself. */
const HOSTED_RUNNER_ALLOWED = new Set([
  "reboot-builder-once.yml",
  "recover-builder.yml",
  "repair-builder-runner-once.yml",
]);

/** Names that always mean "changes production"; never allowed in READ_ONLY. */
const MUTATING_NAME =
  /reboot|recover|repair|emergency|deploy|migrat|publish(?!ed)|enable-|cancel|backfill|import(?!-once)|bulk-load|restart|restore-postgres|poweroff|kill-|drain|reclaim|recreate|provision|throughput|set-federal/;

type Step = { name?: string; run?: string; env?: Record<string, unknown>; if?: unknown };
type Job = { "runs-on"?: unknown; if?: unknown; env?: Record<string, unknown>; steps?: Step[]; uses?: string };
type Workflow = { name?: string; on?: unknown; jobs?: Record<string, Job> };
type Input = { required?: boolean; type?: string };

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort();
}

function parse(file: string): Workflow {
  const source = readFileSync(join(WORKFLOW_DIR, file), "utf8");
  return load(source, { filename: file }) as Workflow;
}

/** Normalize `on:` (string, list, or map) to a map of event -> config. */
function triggers(workflow: Workflow): Record<string, unknown> {
  const on = workflow.on;
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [String(event), null]));
  if (on && typeof on === "object") return on as Record<string, unknown>;
  return {};
}

function dispatchInputs(workflow: Workflow): Record<string, Input> {
  const dispatch = triggers(workflow).workflow_dispatch;
  if (!dispatch || typeof dispatch !== "object") return {};
  return ((dispatch as { inputs?: Record<string, Input> }).inputs ?? {}) as Record<string, Input>;
}

function mentionsConfirm(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return /inputs\.confirm/.test(text);
}

/** True when the step reads inputs.confirm and exits non-zero on a mismatch. */
function isConfirmGate(step: Step | undefined, jobEnv?: Record<string, unknown>): boolean {
  if (!step || typeof step.run !== "string") return false;
  const readsConfirm = mentionsConfirm(step.env) || mentionsConfirm(step.run) || mentionsConfirm(jobEnv);
  const comparesConfirm = /\$\{?CONFIRM\}?"?\s*!=|inputs\.confirm/.test(step.run);
  return readsConfirm && comparesConfirm && /exit 1/.test(step.run);
}

function runnerLabels(job: Job): string {
  return JSON.stringify(job["runs-on"] ?? "").toLowerCase();
}

const files = workflowFiles();
const parsed = new Map(files.map((file) => [file, parse(file)] as const));

describe("workflow trigger policy", () => {
  it("finds the workflow files", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const file of Object.keys(AUTO_TRIGGERS)) expect(files).toContain(file);
    for (const file of READ_ONLY) expect(files).toContain(file);
    for (const file of HOSTED_RUNNER_ALLOWED) expect(files).toContain(file);
  });

  it.each(files)("%s has only allowlisted automatic triggers", (file) => {
    const events = Object.keys(triggers(parsed.get(file)!));
    const automatic = events.filter((event) => (AUTOMATIC_EVENTS as readonly string[]).includes(event));
    const allowed = AUTO_TRIGGERS[file] ?? [];
    const unexpected = automatic.filter((event) => !allowed.includes(event));
    expect(unexpected, `${file} must be workflow_dispatch-only (found ${unexpected.join(", ")})`).toEqual([]);
    // Nothing else (repository_dispatch, release, issues, ...) either.
    const other = events.filter(
      (event) => event !== "workflow_dispatch" && !(AUTOMATIC_EVENTS as readonly string[]).includes(event),
    );
    expect(other, `${file} has unexpected trigger(s)`).toEqual([]);
  });

  it("only lets the public web deploy follow CI", () => {
    const on = triggers(parsed.get("deploy-public-web-hosted.yml")!);
    const run = on.workflow_run as { workflows?: string[]; branches?: string[] };
    expect(run.workflows).toEqual(["CI"]);
    expect(run.branches).toEqual(["main"]);
  });

  it.each(files.filter((file) => !READ_ONLY.has(file)))(
    "%s requires a typed confirm input checked before any work",
    (file) => {
      const workflow = parsed.get(file)!;
      const confirm = dispatchInputs(workflow).confirm;
      expect(confirm, `${file} needs a workflow_dispatch input named confirm`).toBeDefined();
      expect(confirm?.required, `${file}: confirm must be required`).toBe(true);
      expect(confirm?.type ?? "string").toBe("string");
      for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
        const gatedByIf = mentionsConfirm(job.if);
        const gatedByFirstStep = isConfirmGate(job.steps?.[0], job.env);
        expect(gatedByIf || gatedByFirstStep, `${file} job ${name} must check confirm first`).toBe(true);
      }
    },
  );

  it("never treats a production-changing name as read-only", () => {
    const mislabeled = [...READ_ONLY]
      .map((file) => file.replace(/\.ya?ml$/, ""))
      .filter((stem) => !/^(diagnose|scout|verify|monitor|probe)-/.test(stem))
      .filter((stem) => MUTATING_NAME.test(stem));
    expect(mislabeled).toEqual([]);
  });

  it.each(files)("%s uses builder-01 unless it repairs the builder", (file) => {
    for (const [name, job] of Object.entries(parsed.get(file)!.jobs ?? {})) {
      const labels = runnerLabels(job);
      if (HOSTED_RUNNER_ALLOWED.has(file)) continue;
      expect(labels, `${file} job ${name} must not use a GitHub-hosted runner`).not.toMatch(
        /ubuntu-|windows-|macos-/,
      );
      if (job.uses) continue;
      expect(labels, `${file} job ${name} must run on builder-01`).toContain('"self-hosted"');
      expect(labels).toContain('"builder"');
    }
  });

  it.each([...SCHEDULED_WITH_CONFIRM])("%s gates manual runs and lets only schedule events skip", (file) => {
    const workflow = parsed.get(file)!;
    expect(Object.keys(triggers(workflow)).sort()).toEqual(["schedule", "workflow_dispatch"]);
    for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
      const first = job.steps?.[0];
      expect(isConfirmGate(first, job.env), `${file} job ${name}`).toBe(true);
      expect(first?.run).toMatch(/\$EVENT_NAME" != "schedule" \] && \[ "\$CONFIRM" != "/);
      expect(JSON.stringify(first?.env)).toContain("github.event_name");
    }
  });

  it("keeps the federal metadata publication switch behind its confirm gate", () => {
    const workflow = parsed.get("enable-federal-metadata-publication-once.yml")!;
    expect(Object.keys(triggers(workflow))).toEqual(["workflow_dispatch"]);
    expect(dispatchInputs(workflow).confirm?.required).toBe(true);
  });

  it("dispatch-only reboot and recovery workflows cannot run on a merge", () => {
    for (const file of [
      "reboot-ingestion-once.yml",
      "emergency-production-recovery.yml",
      "deploy-production.yml",
      "reboot-builder-once.yml",
      "recover-builder.yml",
      "repair-builder-runner-once.yml",
    ]) {
      expect(Object.keys(triggers(parsed.get(file)!)), file).toEqual(["workflow_dispatch"]);
    }
  });

  const GH_CLI = /(^|[\s;|&($])gh\s+(api|issue|pr|run|workflow|release|repo|secret|auth)\b/m;
  const GH_HELPER = /\bgh_(api|api_post|api_paginate|patch_body|comment|issue_create|dispatch)\b/;

  it.each(files)("%s never calls the gh CLI on builder-01 (it has curl and jq, not gh)", (file) => {
    // The first post-#544 public deploy failed with "gh: command not found", and the
    // nightly backup would have failed the same way. Only the builder-recovery
    // workflows on GitHub-hosted runners may use gh.
    for (const [name, job] of Object.entries(parsed.get(file)!.jobs ?? {})) {
      if (HOSTED_RUNNER_ALLOWED.has(file) && /ubuntu-/.test(runnerLabels(job))) continue;
      for (const step of job.steps ?? []) {
        expect(step.run ?? "", `${file} job ${name} step ${step.name ?? "(unnamed)"}`).not.toMatch(GH_CLI);
      }
    }
  });

  // deploy-public-web-hosted.yml keeps its own gh-api.sh helper from #545.
  it.each(files.filter((file) => file !== "deploy-public-web-hosted.yml"))("%s installs the REST helpers before any step that uses them", (file) => {
    for (const [name, job] of Object.entries(parsed.get(file)!.jobs ?? {})) {
      const steps = job.steps ?? [];
      const users = steps.flatMap((step, index) =>
        GH_HELPER.test(step.run ?? "") && !/\bgh_\w+\(\)\s*\{/.test(step.run ?? "") ? [index] : [],
      );
      if (users.length === 0) continue;
      const install = steps.findIndex((step) => /cat > "\$RUNNER_TEMP\/gh-rest\.sh"/.test(step.run ?? ""));
      expect(install, `${file} job ${name} needs the gh-rest helper step`).toBeGreaterThanOrEqual(0);
      expect(String(steps[install]?.if ?? ""), `${file}: helper step must run even after a failure`).toContain("always()");
      for (const index of users) {
        expect(index, `${file} job ${name}: helper installed after step ${index}`).toBeGreaterThan(install);
        expect(steps[index]?.run, `${file} job ${name} step ${index} must source the helpers`).toContain('source "$RUNNER_TEMP/gh-rest.sh"');
      }
    }
  });

  it("the nightly bulk docket load is dispatch-only, gated, resumable and bounded", () => {
    const file = "load-courtlistener-bulk-dockets-nightly.yml";
    const workflow = parsed.get(file)!;
    expect(Object.keys(triggers(workflow))).toEqual(["workflow_dispatch"]);
    const inputs = dispatchInputs(workflow) as Record<string, Input & { default?: string }>;
    expect(Object.keys(inputs).sort()).toEqual(["allow_anytime", "confirm", "row_limit", "snapshot_date"]);
    expect(inputs.allow_anytime?.default).toBe("false");
    expect(Number(inputs.row_limit?.default)).toBeGreaterThanOrEqual(5_000_000);
    const job = workflow.jobs!.load!;
    expect(runnerLabels(job)).toContain('"builder"');
    expect(job.steps?.[0]?.run).toContain('"$CONFIRM" != "LOAD_DOCKETS"');
    const script = (job.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(script).toContain("--budget-minutes=90");
    expect(script).toContain("--reset-checkpoint=false");
    expect(script).toContain("--include-bankruptcy=false");
    expect(script).toContain("remain / total < 0.30");
    // Cached between runs; deleted only when the checkpoint says complete.
    expect(script).toMatch(/cache=hit/);
    expect(script).toMatch(/"stopped":"complete"'; then\s+done_flag=true[\s\S]*rm -f "\$file"/);
  });

  it("the bulk opinion measurement is dispatch-only, gated, bounded and serialized with docket loads", () => {
    const workflow = parsed.get("measure-courtlistener-bulk-opinions-once.yml")!;
    expect(Object.keys(triggers(workflow))).toEqual(["workflow_dispatch"]);
    const inputs = dispatchInputs(workflow) as Record<string, Input & { default?: string }>;
    expect(inputs.row_limit?.default).toBe("50000");
    expect(inputs.allow_anytime?.default).toBe("false");
    const job = workflow.jobs!.measure!;
    expect(runnerLabels(job)).toContain('"builder"');
    expect(job.steps?.[0]?.run).toContain('"$CONFIRM" != "MEASURE_OPINIONS"');
    expect(JSON.stringify((workflow as { concurrency?: unknown }).concurrency)).toContain("jurvio-bulk-docket-load");
    const script = (job.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(script).toContain("--budget-minutes=90");
    expect(script).toContain("avail / total < 0.30");
  });

  it("helper rejects a step that does not compare confirm", () => {
    expect(isConfirmGate({ run: "echo hi", env: { CONFIRM: "${{ inputs.confirm }}" } })).toBe(false);
    expect(
      isConfirmGate({
        env: { CONFIRM: "${{ inputs.confirm }}" },
        run: 'if [ "$CONFIRM" != "X" ]; then\n  exit 1\nfi',
      }),
    ).toBe(true);
  });
});
