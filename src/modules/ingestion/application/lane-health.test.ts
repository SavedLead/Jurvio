import { describe, expect, it } from "vitest";
import { isLaneRunHealthy, LANE_ERROR_TAIL_MAX } from "./lane-health";

describe("lane-health run classification", () => {
  it("treats a clean exit (code 0, no signal) as healthy", () => {
    expect(isLaneRunHealthy(0, null)).toBe(true);
  });

  it("treats a non-zero exit as unhealthy", () => {
    // This is the scotus-enriched crash: the lane throws on an over-large --limit
    // and exits code 1 before doing any work.
    expect(isLaneRunHealthy(1, null)).toBe(false);
    expect(isLaneRunHealthy(137, null)).toBe(false);
  });

  it("treats a signal death as unhealthy even if the code is 0", () => {
    // SIGKILL/OOM or SIGTERM: the child did not finish its work cleanly.
    expect(isLaneRunHealthy(0, "SIGKILL")).toBe(false);
    expect(isLaneRunHealthy(0, "SIGTERM")).toBe(false);
    expect(isLaneRunHealthy(null, "SIGKILL")).toBe(false);
  });

  it("treats a spawn failure (null code, null signal) as unhealthy", () => {
    expect(isLaneRunHealthy(null, null)).toBe(false);
  });

  it("bounds the persisted error tail", () => {
    expect(LANE_ERROR_TAIL_MAX).toBeGreaterThan(0);
    const tail = "x".repeat(LANE_ERROR_TAIL_MAX * 2).slice(-LANE_ERROR_TAIL_MAX);
    expect(tail.length).toBe(LANE_ERROR_TAIL_MAX);
  });
});
