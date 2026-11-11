import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/catch-up-published-search.sh");

function runFedToBash(phase: string) {
  const dir = mkdtempSync(join(tmpdir(), "catchup-stdin-"));
  const docker = join(dir, "docker");
  const bytes = join(dir, "stdin-bytes");
  writeFileSync(docker, `#!/bin/sh
if [ "$1" = ps ]; then
  echo fake-pg
  exit 0
fi
wc -c < /dev/stdin >> ${bytes}
if printf '%s' "$*" | grep -q "SELECT phase FROM"; then
  printf '%s\\n' "${phase}"
fi
exit 0
`);
  chmodSync(docker, 0o755);
  const result = spawnSync("bash", ["-s"], {
    input: script,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      // Production waits 5 minutes, then longer, for about 3 hours. This test
      // feeds the script a docker that never commits a batch. Leave the waits
      // at zero or spawnSync blocks until CI hits its 45-minute limit.
      CATCHUP_STALL_WAIT: "0",
      CATCHUP_STALL_LIMIT: "0",
    },
  });
  const stdinBytes = readFileSync(bytes, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { ...result, stdinBytes };
}

describe("catch-up script fed to bash -s", () => {
  it("reaches the loop when docker exec does not drain the script", () => {
    const result = runFedToBash("done");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("resuming from search_catchup_cursor");
    expect(result.stdout).toContain("catch-up complete");
    expect(result.status).toBe(0);
    // -c queries must see an empty stdin. A drained script is thousands of bytes.
    expect(result.stdinBytes.some((size) => size === "0")).toBe(true);
  });

  it("fails when the loop never prints catch-up complete", () => {
    const result = runFedToBash("");
    expect(result.stdout).not.toContain("catch-up complete");
    expect(result.stderr).toContain("catch-up stopped after 0s without a committed batch");
    expect(result.stderr).not.toContain("catch-up waiting");
    expect(result.status).not.toBe(0);
  });
});
