// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("../e2e/fixtures/electron", () => ({ closeElectronApp: vi.fn() }));
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeRecoveryVerdict, persistFailedRecoveryObservation } from "../e2e/fixtures/recovery-contract-probe";

it("retains the last actual stalled state and timeout instead of discarding the trial", async () => {
  let reads = 0;
  const observation = await observeRecoveryVerdict(
    () => ({ revision: ++reads, state: "stalled" }),
    () => false,
    1,
  );
  expect(observation.timedOut).toBe(true);
  expect(observation.error).toContain("timed out");
  expect(observation.value).toEqual({ revision: reads, state: "stalled" });
  expect(reads).toBeGreaterThan(1);
});
it("preserves a reached recovery verdict without a timeout", async () => {
  expect(
    await observeRecoveryVerdict(
      () => ({ state: "reconcile" }),
      (value) => value.state === "reconcile",
      1000,
    ),
  ).toEqual({ value: { state: "reconcile" }, timedOut: false, error: "" });
});

it.each([false, true])("persists a mid-sequence failure when snapshot read fails=%s", (unreadable) => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-incomplete-observation-"));
  try {
    const value = { state: "running", phase: "effect_pending" };
    const artifact = persistFailedRecoveryObservation(dir, () => {
      if (unreadable) throw new Error("snapshot unavailable");
      return value;
    }, new Error("second durable boundary timed out"));
    const bytes = readFileSync(artifact.path);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(JSON.parse(bytes.toString("utf8"))).toEqual({
      error: "Error: second durable boundary timed out",
      value: unreadable ? null : value,
      snapshotError: unreadable ? "Error: snapshot unavailable" : "",
      driven_by: "agent", actor: "recovery-contract-matrix", realHumanEvidence: false,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
