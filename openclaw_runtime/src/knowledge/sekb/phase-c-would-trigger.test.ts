import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import {
  isSekbPhaseCWouldTriggerEnabled,
  resolveSekbPhaseCWouldTriggerOwner,
  resolveSekbPhaseCWouldTriggerTimeoutMs,
} from "./feature-flags.js";
import { KnowledgeStore } from "./knowledge-store.js";
import {
  projectWouldTriggerFromShadowScore,
  SekbPhaseCWouldTriggerScheduler,
  SEKB_PHASE_C_SHADOW_V1_THRESHOLD,
  snapshotPhaseCObservability,
} from "./phase-c-would-trigger.js";
import type { Trajectory } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempStore(): KnowledgeStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-phase-c-"));
  tempDirs.push(root);
  return new KnowledgeStore({ database: { path: path.join(root, "openclaw.sqlite") } });
}

function sampleTrajectory(overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    trajectory_id: overrides.trajectory_id ?? "traj-1",
    created_at: overrides.created_at ?? "2026-07-15T00:00:00.000Z",
    task_intent: overrides.task_intent ?? "evaluate sekb",
    task_type: overrides.task_type ?? "eval",
    context_fingerprint: overrides.context_fingerprint ?? ["sekb"],
    steps: overrides.steps ?? [{ action: "tool.call", input: {}, output: {}, timestamp: "2026-07-15T00:00:00.000Z" }],
    outcome: overrides.outcome ?? "success",
    error_signature: overrides.error_signature ?? null,
    cost: overrides.cost ?? { tokens: 1, duration_seconds: 1, retries: 0 },
    distilled: overrides.distilled ?? false,
    distilled_into: overrides.distilled_into ?? [],
    expires_at: overrides.expires_at ?? null,
    metadata: overrides.metadata ?? {
      sekbShadow: {
        schema: "sekb-shadow-metadata.v1",
        captureQuality: {
          schema: "sekb-capture-quality-shadow.v1",
          score: 80,
          recommendation: "retain",
          factors: {
            terminalOutcome: 1,
            toolEvidence: 1,
            errorResolutionEvidence: null,
            recurrenceEvidence: null,
            validationEvidence: null,
            userConfirmationEvidence: null,
          },
          evidenceAvailable: ["terminal_outcome"],
          evidenceMissing: ["validation"],
        },
        completionEvidence: {
          schema: "sekb-completion-evidence.v1",
          status: "supported",
          reasons: ["terminal_success"],
          terminalOutcome: "success",
          validationObserved: false,
          unresolvedErrorObserved: false,
          explicitConfirmationObserved: false,
          evidenceAvailable: ["terminal_outcome"],
          evidenceMissing: ["validation"],
        },
      },
    },
  };
}

describe("SEKB Phase C would_trigger flags", () => {
  it("defaults off and requires master SEKB", () => {
    expect(isSekbPhaseCWouldTriggerEnabled({}, {})).toBe(false);
    expect(
      isSekbPhaseCWouldTriggerEnabled(
        { runtime: { contextBlock: { sekb: { phaseCWouldTrigger: { enabled: true } } } } },
        {},
      ),
    ).toBe(false);
    expect(
      isSekbPhaseCWouldTriggerEnabled(
        {
          runtime: {
            contextBlock: {
              sekb: { enabled: true, phaseCWouldTrigger: { enabled: true, owner: "ops", timeoutMs: 2500 } },
            },
          },
        },
        {},
      ),
    ).toBe(true);
    expect(
      isSekbPhaseCWouldTriggerEnabled(
        { runtime: { contextBlock: { sekb: { enabled: true, phaseCWouldTrigger: { enabled: true } } } } },
        { OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED: "0" },
      ),
    ).toBe(false);
    expect(resolveSekbPhaseCWouldTriggerOwner({
      runtime: { contextBlock: { sekb: { phaseCWouldTrigger: { owner: "  d1-owner  " } } } },
    })).toBe("d1-owner");
    expect(resolveSekbPhaseCWouldTriggerTimeoutMs({
      runtime: { contextBlock: { sekb: { phaseCWouldTrigger: { timeoutMs: 3200 } } } },
    })).toBe(3200);
  });

  it("projects frozen Shadow V1 threshold 50", () => {
    expect(SEKB_PHASE_C_SHADOW_V1_THRESHOLD).toBe(50);
    expect(projectWouldTriggerFromShadowScore(50).wouldTrigger).toBe(true);
    expect(projectWouldTriggerFromShadowScore(49).wouldTrigger).toBe(false);
    expect(projectWouldTriggerFromShadowScore(null).wouldTrigger).toBe(false);
  });
});

describe("SEKB Phase C would_trigger scheduler", () => {
  it("flag off is parity path with no durable mutation and no true would_trigger", async () => {
    const store = tempStore();
    const beforeT = store.query_trajectories({}).length;
    const beforeP = store.query_principles({}).length;
    const scheduler = new SekbPhaseCWouldTriggerScheduler({
      owner: "test-owner",
      workspaceKey: "ws-a",
    });
    const result = await scheduler.evaluate({
      flagEnabled: false,
      trajectories: [sampleTrajectory()],
    });
    expect(result.flagEnabled).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.durableMutation).toBe(false);
    expect(result.counters.suppressed_by_flag).toBe(1);
    expect(result.counters.wouldTriggerTrue).toBe(0);
    expect(store.query_trajectories({}).length).toBe(beforeT);
    expect(store.query_principles({}).length).toBe(beforeP);
    expect(snapshotPhaseCObservability(scheduler, false)["pilot.flag_state"]).toBe("off");
  });

  it("flag on emits evidence only without store mutation", async () => {
    const store = tempStore();
    const traj = sampleTrajectory({ trajectory_id: "traj-hi" });
    store.save_trajectory(traj);
    const beforeT = store.query_trajectories({}).length;
    const beforeP = store.query_principles({}).length;
    const beforeJson = JSON.stringify(store.get_trajectory("traj-hi"));

    const scheduler = new SekbPhaseCWouldTriggerScheduler({
      owner: "test-owner",
      workspaceKey: "ws-b",
    });
    const result = await scheduler.evaluate({
      flagEnabled: true,
      trajectories: [traj, sampleTrajectory({ trajectory_id: "traj-lo", metadata: {
        sekbShadow: {
          schema: "sekb-shadow-metadata.v1",
          captureQuality: {
            schema: "sekb-capture-quality-shadow.v1",
            score: 10,
            recommendation: "review_low_signal",
            factors: {
              terminalOutcome: 1,
              toolEvidence: 0,
              errorResolutionEvidence: null,
              recurrenceEvidence: null,
              validationEvidence: null,
              userConfirmationEvidence: null,
            },
            evidenceAvailable: ["terminal_outcome"],
            evidenceMissing: ["validation"],
          },
          completionEvidence: {
            schema: "sekb-completion-evidence.v1",
            status: "partial",
            reasons: ["terminal_success"],
            terminalOutcome: "success",
            validationObserved: false,
            unresolvedErrorObserved: false,
            explicitConfirmationObserved: false,
            evidenceAvailable: ["terminal_outcome"],
            evidenceMissing: ["validation"],
          },
        },
      } })],
    });

    expect(result.durableMutation).toBe(false);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]?.wouldTrigger).toBe(true);
    expect(result.evidence[0]?.offlineArtifactsUsed).toBe(false);
    expect(result.evidence[1]?.wouldTrigger).toBe(false);
    expect(result.counters.count).toBe(2);
    expect(result.counters.wouldTriggerTrue).toBe(1);
    expect(store.query_trajectories({}).length).toBe(beforeT);
    expect(store.query_principles({}).length).toBe(beforeP);
    expect(JSON.stringify(store.get_trajectory("traj-hi"))).toBe(beforeJson);
    expect(snapshotPhaseCObservability(scheduler, true)["would_trigger.count"]).toBe(2);
  });

  it("single-flight lease reports busy without mutation", async () => {
    const scheduler = new SekbPhaseCWouldTriggerScheduler({
      timeoutMs: 200,
      sleep: async (ms, signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, ms);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          }, { once: true });
        });
      },
    });
    const slow = scheduler.evaluate({
      flagEnabled: true,
      trajectories: [sampleTrajectory()],
      artificialWorkMs: 80,
    });
    const busy = await scheduler.evaluate({
      flagEnabled: true,
      trajectories: [sampleTrajectory({ trajectory_id: "other" })],
    });
    expect(busy.counters.lease_busy).toBe(1);
    expect(busy.evidence).toEqual([]);
    await slow;
  });

  it("timeout cancel records counter and does not mutate", async () => {
    const store = tempStore();
    const beforeP = store.query_principles({}).length;
    const scheduler = new SekbPhaseCWouldTriggerScheduler({
      timeoutMs: 20,
      sleep: async (ms, signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, ms);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          }, { once: true });
        });
      },
    });
    const result = await scheduler.evaluate({
      flagEnabled: true,
      trajectories: [sampleTrajectory()],
      artificialWorkMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.counters.timeout_cancel).toBe(1);
    expect(result.evidence).toEqual([]);
    expect(store.query_principles({}).length).toBe(beforeP);
  });
});