import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createMission, tickMission, type MissionControllerDeps } from "./controller.js";
import type { MissionRunRecord } from "./types.js";
import * as longTaskStore from "../long-task-control/store.js";
import type { LongTaskCheckpointRecord } from "../long-task-control/store.js";

function makeReviewer(decision: "repair" | "complete") {
  return vi.fn(async () => ({
    decision,
    confidence: 0.55,
    reason: decision === "repair" ? "Mission needs scoped repair." : "done",
    missingEvidence: decision === "repair" ? ["acceptance"] : [],
    verificationGaps: decision === "repair" ? ["validation"] : [],
    risks: [],
    memoryCandidates: [],
    checkpointSummary: "summary",
  }));
}

function makeTaskLoop() {
  return vi.fn(async () => ({
    loopRunId: "loop-1",
    traceId: "trace-1",
    status: "complete" as const,
    finalSummary: "done",
    evidenceRefs: [],
    risks: [],
    remaining: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }));
}

function inMemoryDeps(overrides: {
  reviewer?: ReturnType<typeof makeReviewer>;
  rollback?: MissionControllerDeps["rollback"];
  mission?: MissionRunRecord;
} = {}): { deps: MissionControllerDeps; missions: Map<string, MissionRunRecord> } {
  const missions = new Map<string, MissionRunRecord>();
  if (overrides.mission) missions.set(overrides.mission.missionId, overrides.mission);
  const deps: MissionControllerDeps = {
    getMission: (missionId: string) => missions.get(missionId),
    saveMission: (record: MissionRunRecord) => {
      missions.set(record.missionId, record);
      return record;
    },
    getLatestMissionForSession: (sessionKey: string) =>
      [...missions.values()].find((m) => m.sessionKey === sessionKey),
    recordEvent: () => undefined,
    storeTrace: () => undefined,
    proposeMemory: () => ({ action: "accept" as const, accepted: true }),
    createKnowledgeInboxItem: () => undefined,
    runTaskLoop: makeTaskLoop() as unknown as MissionControllerDeps["runTaskLoop"],
    taskLoopDeps: {},
    reviewer: overrides.reviewer ?? makeReviewer("repair"),
    reviewerDeps: {},
    rollback: overrides.rollback,
  };
  return { deps, missions };
}

function missionConfig(rollbackEnabled: boolean): OpenClawConfig {
  return {
    agents: { defaults: { missionLoop: { enabled: true } } },
    runtime: {
      mission: { rollback: { enabled: rollbackEnabled } },
    },
  } as unknown as OpenClawConfig;
}

describe("mission-control rollback wiring (A3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps legacy blocked behavior when rollback is not wired", async () => {
    const { deps, missions } = inMemoryDeps();
    const mission = createMission(
      { objective: "task", sessionKey: "agent::s1" },
      missionConfig(true), // config on, but deps.rollback undefined
      deps,
    );
    missions.set(mission.missionId, mission);

    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);
    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);

    const record = missions.get(mission.missionId)!;
    expect(record.status).toBe("blocked");
    expect(record.blockedReason).toContain("repeated without progress");
  });

  it("rolls back to checkpoint and stays sleeping when enabled and checkpoint exists", async () => {
    const rollbackDeps: MissionControllerDeps["rollback"] = {
      loadCheckpoint: vi.fn(async () => ({ id: "c1" })),
      validateCheckpoint: vi.fn(async (): Promise<{ ok: true }> => ({ ok: true })),
      applyCheckpoint: vi.fn(async () => undefined),
      replayEventLog: vi.fn(async () => ({ ok: false, reason: "n/a" })),
      recordOutcome: vi.fn(),
    };
    // Make listLongTaskCheckpoints return [current-tick, previous-tick] so the
    // repeated-repair branch rolls back to the PREVIOUS tick checkpoint.
    const previousCheckpoint: LongTaskCheckpointRecord = {
      id: "c0",
      sessionKey: "agent::s1",
      trigger: "guide",
      status: "repair",
      checkpoint: {
        schemaVersion: 1,
        id: "c0",
        sessionKey: "agent::s1",
        trigger: "guide",
        openBlockers: [],
        decisions: [],
        deviations: [],
        filesTouched: [],
        testsRun: [],
        reviewNeededItems: [],
        evidenceRefs: [],
        createdAt: "2026-07-30T00:00:00.000Z",
      },
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    };
    const currentCheckpoint: LongTaskCheckpointRecord = {
      ...previousCheckpoint,
      id: "c1",
      checkpoint: { ...previousCheckpoint.checkpoint, id: "c1", createdAt: new Date().toISOString() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const listSpy = vi
      .spyOn(longTaskStore, "listLongTaskCheckpoints")
      .mockReturnValue([currentCheckpoint, previousCheckpoint]);
    const { deps, missions } = inMemoryDeps({ rollback: rollbackDeps });
    const mission = createMission(
      { objective: "task", sessionKey: "agent::s1" },
      missionConfig(true),
      deps,
    );
    missions.set(mission.missionId, mission);

    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);
    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);

    const record = missions.get(mission.missionId)!;
    expect(rollbackDeps.applyCheckpoint).toHaveBeenCalled();
    expect(record.status).toBe("sleeping");
    expect(record.phase).toBe("schedule");
    expect(record.noProgressHash).toBeUndefined();
    listSpy.mockRestore();
  });

  it("blocks with rollback failure detail when rollback fails", async () => {
    const rollbackDeps: MissionControllerDeps["rollback"] = {
      loadCheckpoint: vi.fn(async () => ({ id: "c1" })),
      validateCheckpoint: vi.fn(async (): Promise<{ ok: false; reason: string }> => ({ ok: false, reason: "corrupt" })),
      applyCheckpoint: vi.fn(async () => undefined),
      replayEventLog: vi.fn(async () => ({ ok: false, reason: "n/a" })),
      recordOutcome: vi.fn(),
    };
    const previousCheckpoint: LongTaskCheckpointRecord = {
      id: "c0",
      sessionKey: "agent::s1",
      trigger: "guide",
      status: "repair",
      checkpoint: {
        schemaVersion: 1,
        id: "c0",
        sessionKey: "agent::s1",
        trigger: "guide",
        openBlockers: [],
        decisions: [],
        deviations: [],
        filesTouched: [],
        testsRun: [],
        reviewNeededItems: [],
        evidenceRefs: [],
        createdAt: "2026-07-30T00:00:00.000Z",
      },
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    };
    const currentCheckpoint: LongTaskCheckpointRecord = {
      ...previousCheckpoint,
      id: "c1",
      checkpoint: { ...previousCheckpoint.checkpoint, id: "c1", createdAt: new Date().toISOString() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const listSpy = vi
      .spyOn(longTaskStore, "listLongTaskCheckpoints")
      .mockReturnValue([currentCheckpoint, previousCheckpoint]);
    const { deps, missions } = inMemoryDeps({ rollback: rollbackDeps });
    const mission = createMission(
      { objective: "task", sessionKey: "agent::s1" },
      missionConfig(true),
      deps,
    );
    missions.set(mission.missionId, mission);

    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);
    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);

    const record = missions.get(mission.missionId)!;
    expect(record.status).toBe("blocked");
    expect(record.blockedReason).toContain("rollback failed");
    listSpy.mockRestore();
  });

  it("blocks with no-checkpoint detail when only the current-tick checkpoint exists", async () => {
    const rollbackDeps: MissionControllerDeps["rollback"] = {
      loadCheckpoint: vi.fn(async () => ({ id: "c1" })),
      validateCheckpoint: vi.fn(async (): Promise<{ ok: true }> => ({ ok: true })),
      applyCheckpoint: vi.fn(async () => undefined),
      replayEventLog: vi.fn(async () => ({ ok: false, reason: "n/a" })),
      recordOutcome: vi.fn(),
    };
    // Only the current tick's checkpoint exists — there is no earlier state to
    // roll back to, so the branch must block with "no checkpoint available".
    const currentCheckpoint: LongTaskCheckpointRecord = {
      id: "c1",
      sessionKey: "agent::s1",
      trigger: "guide",
      status: "repair",
      checkpoint: {
        schemaVersion: 1,
        id: "c1",
        sessionKey: "agent::s1",
        trigger: "guide",
        openBlockers: [],
        decisions: [],
        deviations: [],
        filesTouched: [],
        testsRun: [],
        reviewNeededItems: [],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const listSpy = vi
      .spyOn(longTaskStore, "listLongTaskCheckpoints")
      .mockReturnValue([currentCheckpoint]);
    const { deps, missions } = inMemoryDeps({ rollback: rollbackDeps });
    const mission = createMission(
      { objective: "task", sessionKey: "agent::s1" },
      missionConfig(true),
      deps,
    );
    missions.set(mission.missionId, mission);

    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);
    await tickMission({ missionId: mission.missionId, reason: "manual" }, missionConfig(true), deps);

    const record = missions.get(mission.missionId)!;
    expect(record.status).toBe("blocked");
    expect(record.blockedReason).toContain("no checkpoint available");
    expect(rollbackDeps.applyCheckpoint).not.toHaveBeenCalled();
    listSpy.mockRestore();
  });
});
