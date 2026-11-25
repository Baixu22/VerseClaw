// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("../e2e/fixtures/electron", () => ({ closeElectronApp: vi.fn() }));
vi.mock("../e2e/fixtures/fp-p1-harness", () => ({ hostInvoke: vi.fn() }));
import type { ElectronApplication } from "@playwright/test";
import { closeElectronApp } from "../e2e/fixtures/electron";
import { hostInvoke } from "../e2e/fixtures/fp-p1-harness";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeRecoveryApp, finishRecoveryTrialCleanup, observeRecoveryVerdict, persistFailedRecoveryObservation, isRecoveryWarmupSettled, isRecoveryDiskVerdictSettled, readProbeFiles, readRecoveryFaultBoundary, effectLines } from "../e2e/fixtures/recovery-contract-probe";

it("preserves the trial error and attempts every cleanup before rejecting", async () => {
  const failure = new Error("effect missing");
  const cleanupFailure = new Error("app still alive");
  const calls: string[] = [];
  const error = await finishRecoveryTrialCleanup([failure], [
    () => { calls.push("probe"); },
    () => { calls.push("app"); throw cleanupFailure; },
    async () => { calls.push("provider"); },
  ]).catch((error: unknown) => error);
  expect(calls).toEqual(["probe", "app", "provider"]);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([failure, cleanupFailure]);
  expect(String(error)).toContain(failure.message);
  expect(String(error)).toContain(cleanupFailure.message);
  await expect(finishRecoveryTrialCleanup([], [async () => {}])).resolves.toBeUndefined();
});

it("preserves the pre-cleanup failure snapshot when cleanup changes observable state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-failure-order-"));
  try {
    let effect = "pending";
    const reads = { effect: () => effect };
    const error = new Error("boundary failed");
    const before = persistFailedRecoveryObservation(dir, reads, error, "before-cleanup.json");
    await finishRecoveryTrialCleanup([], [() => { effect = "applied"; }]);
    const after = persistFailedRecoveryObservation(dir, reads, error, "after-cleanup.json");
    expect(JSON.parse(readFileSync(before.path, "utf8")).value.effect).toBe("pending");
    expect(JSON.parse(readFileSync(after.path, "utf8")).value.effect).toBe("applied");
    expect(createHash("sha256").update(readFileSync(before.path)).digest("hex")).toBe(before.sha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("waits for a yielded command's effect before admitting its crash boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-effect-boundary-"));
  try {
    const path = join(dir, "effects.jsonl");
    const point = "tool-return-before-receipt";
    const hit = { pid: 1234, point, observedAt: 1, action: "pause", id: "effect" };
    writeFileSync(join(dir, "hit-1.json"), JSON.stringify(hit));
    expect(readRecoveryFaultBoundary(dir, point, new Set(), path)).toBeUndefined();
    expect(readRecoveryFaultBoundary(dir, point, new Set())).toMatchObject(hit);
    writeFileSync(path, "");
    expect(readRecoveryFaultBoundary(dir, point, new Set(), path)).toBeUndefined();
    writeFileSync(path, "effect\n", { flush: true });
    expect(readRecoveryFaultBoundary(dir, point, new Set(), path)).toMatchObject(hit);
    expect(readRecoveryFaultBoundary(dir, point, new Set([hit.pid]), path)).toBeUndefined();
    // Preserve the driver's exact-effect assertion: duplicates must reach it and fail.
    writeFileSync(path, "effect\neffect\n", { flush: true });
    expect(readRecoveryFaultBoundary(dir, point, new Set(), path)).toMatchObject(hit);
    expect(effectLines(path)).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([true, false])("uses one app-close owner after Gateway stop succeeds=%s", async (succeeded) => {
  vi.mocked(hostInvoke).mockReset();
  vi.mocked(closeElectronApp).mockClear();
  vi.mocked(closeElectronApp).mockResolvedValue({ mainExited: true, launcherExited: true, closeSettled: true,
    graceful: true, processes: [], processObservations: [], errors: [] });
  if (succeeded) vi.mocked(hostInvoke).mockResolvedValue({ success: true });
  else vi.mocked(hostInvoke).mockRejectedValue(new Error("Gateway already closed"));
  const app = { close: vi.fn() } as unknown as ElectronApplication;
  await closeRecoveryApp(app);
  expect(hostInvoke).toHaveBeenCalledExactlyOnceWith(app, "gateway", "stop");
  expect(closeElectronApp).toHaveBeenCalledExactlyOnceWith(app, 1_000);
  expect(app.close).not.toHaveBeenCalled();
});

it.each(["mainExited", "launcherExited", "closeSettled"] as const)("rejects incomplete app cleanup: %s", async (field) => {
  vi.mocked(hostInvoke).mockResolvedValue({ success: true });
  vi.mocked(closeElectronApp).mockResolvedValue({ mainExited: true, launcherExited: true, closeSettled: true,
    graceful: false, processes: [], processObservations: [], errors: [], [field]: false });
  await expect(closeRecoveryApp({} as ElectronApplication)).rejects.toThrow("cleanup incomplete");
});

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
    const artifact = persistFailedRecoveryObservation(dir, {
      disk: () => {
        if (unreadable) throw new Error("snapshot unavailable");
        return value;
      },
      hits: () => ["boundary"],
      effects: () => ["effect"],
    }, new Error("second durable boundary timed out"));
    const bytes = readFileSync(artifact.path);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(JSON.parse(bytes.toString("utf8"))).toEqual({
      error: "Error: second durable boundary timed out",
      value: { disk: unreadable ? null : value, hits: ["boundary"], effects: ["effect"] },
      snapshotErrors: unreadable ? { disk: "Error: snapshot unavailable" } : {},
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
