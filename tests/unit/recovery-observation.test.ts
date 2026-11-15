// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("../e2e/fixtures/electron", () => ({ closeElectronApp: vi.fn() }));
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeRecoveryVerdict, persistFailedRecoveryObservation, isRecoveryWarmupSettled, isRecoveryDiskVerdictSettled, readProbeFiles } from "../e2e/fixtures/recovery-contract-probe";

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

it("waits for a durable verdict after a main owner reservation", async () => {
  const pending = {
    disk: { main: { sessionId: "main", status: "running", abortedLastRun: true }, flows: [] },
    decisions: [{ action: "reconcile" }],
  };
  const done = { ...pending, disk: { ...pending.disk, main: { ...pending.disk.main, status: "done" } } };
  let reads = 0;
  const observed = await observeRecoveryVerdict(
    () => ++reads === 1 ? pending : done,
    isRecoveryDiskVerdictSettled,
    1000,
  );
  expect(observed.timedOut).toBe(false);
  expect(observed.value).toEqual(done);
  expect(reads).toBe(2);
  expect(isRecoveryDiskVerdictSettled({ ...pending, disk: { ...pending.disk, main: undefined } })).toBe(false);
  const tombstone = { execution_phase: "effect_pending", state_json: JSON.stringify({ recovery: { needsReconciliation: true } }) };
  expect(isRecoveryDiskVerdictSettled({ ...pending, disk: { ...pending.disk, flows: [tombstone] } })).toBe(true);
  expect(isRecoveryDiskVerdictSettled({ ...pending, decisions: [], disk: { ...pending.disk, flows: [tombstone] } })).toBe(false);
});

it("keeps decision chronology independent of PID-based filenames", () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-probe-order-"));
  try {
    writeFileSync(join(dir, "decision-900-1.json"), JSON.stringify({ pid: 900, observedAt: 1, action: "resume" }));
    writeFileSync(join(dir, "decision-100-1.json"), JSON.stringify({ pid: 100, observedAt: 2, action: "reconcile" }));
    const records = readProbeFiles(dir, "decision-");
    expect(records.map((record) => record.action)).toEqual(["resume", "reconcile"]);
    expect(records.map((record) => record.pid)).toEqual([900, 100]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

it("waits for lifecycle and pending delivery settlement after the warmup answer", () => {
  const disk = {
    main: { sessionId: "warmup", status: "running" },
    branch: [{ message: { role: "assistant", stopReason: "stop", content: "warmup complete" } }],
  };
  const settled = (value: unknown, terminalStatus = "ok") => isRecoveryWarmupSettled(value as Parameters<typeof isRecoveryWarmupSettled>[0], terminalStatus);
  expect(settled(disk)).toBe(false);
  expect(settled({ ...disk, main: { ...disk.main, status: "done", pendingFinalDelivery: true, pendingFinalDeliveryText: "warmup complete" } })).toBe(false);
  expect(settled({ ...disk, main: { ...disk.main, status: "done" } })).toBe(true);
  // The model has finished, but the chat pipeline has not yet persisted/delivered the final.
  expect(settled({ ...disk, main: { ...disk.main, status: "done" } }, "timeout")).toBe(false);
  expect(settled({ ...disk, main: { ...disk.main, status: "done" } }, "error")).toBe(false);
  expect(settled({ ...disk, main: { ...disk.main, status: "done" }, branch: [] })).toBe(false);
});
