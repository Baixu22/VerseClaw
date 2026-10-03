import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  clearTaskStateHandlerConfig,
  setTaskStateHandlerConfig,
} from "../harness/lifecycle-hook-helpers.js";
import { KnowledgeStore } from "../../knowledge/sekb/knowledge-store.js";
import { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { goalWakeController } from "../goal-wake-controller.js";
import { runTaskLoop, type TaskLoopControllerDeps } from "../task-loop-controller.js";
import { tickMission, type MissionControllerDeps } from "./controller.js";
import type { MissionRunRecord } from "./types.js";

const missionId = "mission-fenced-tick-wiring";

function fixture(): MissionRunRecord {
  const now = Date.now();
  return {
    missionId,
    sessionKey: "agent:agent-a:main",
    agentId: "agent-a",
    objective: "prove fenced tick wiring",
    acceptance: [],
    status: "idle",
    phase: "intake",
    tick: 0,
    repairTicks: 0,
    maxTicks: 8,
    maxRepairTicks: 3,
    progress: 0,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ticks: [],
  };
}

function makeDeps(): {
  deps: MissionControllerDeps;
  missions: Map<string, MissionRunRecord>;
  saves: MissionRunRecord[];
  runRequests: unknown[];
} {
  const missions = new Map<string, MissionRunRecord>();
  missions.set(missionId, fixture());
  const saves: MissionRunRecord[] = [];
  const runRequests: unknown[] = [];
  const deps: MissionControllerDeps = {
    getMission: (id: string) => missions.get(id),
    saveMission: (record: MissionRunRecord) => {
      missions.set(record.missionId, record);
      saves.push({ ...record, ticks: [...record.ticks] });
      return record;
    },
    recordEvent: () => undefined,
    storeTrace: () => undefined,
    runTaskLoop: (async (request: unknown) => {
      runRequests.push(request);
      return {
        loopRunId: "loop-1",
        traceId: "trace-1",
        status: "complete" as const,
        finalSummary: "done",
        evidenceRefs: [],
        lineage: {
          schema: "runtime-lineage.v1" as const,
          sessionId: "agent:agent-a:main",
          missionId,
          missionTick: 1,
          loopRunId: "loop-1",
          traceId: "trace-1",
          taskLedgerRootId: "ledger-1",
        },
        sekbTrajectoryId: "trajectory-1",
        risks: [],
        remaining: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }) as unknown as NonNullable<MissionControllerDeps["runTaskLoop"]>,
    reviewer: async () => ({
      decision: "complete" as const,
      confidence: 1,
      reason: "done",
      missingEvidence: [],
      verificationGaps: [],
      risks: [],
      memoryCandidates: [],
      checkpointSummary: "summary",
    }),
    reviewerDeps: {},
    taskLoopDeps: {},
  };
  return { deps, missions, saves, runRequests };
}

function missionConfig(): OpenClawConfig {
  return {
    agents: { defaults: { missionLoop: { enabled: true } } },
  } as unknown as OpenClawConfig;
}

afterEach(() => {
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  clearTaskStateHandlerConfig();
  closeOpenClawStateDatabaseForTest();
  vi.restoreAllMocks();
});

describe("mission-control fenced tick wiring", () => {
  it("uses claimMissionTick and finishMissionTick when mission fencing is enabled", async () => {
    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    const claim = vi.spyOn(goalWakeController, "claimMissionTick").mockReturnValue({
      ok: true,
      revision: 1,
      row: {
        mission_id: missionId,
        tick_count: 1,
        active_tick_id: "mission_tick_mission-fenced-tick-wiring_1",
        last_wake_id: null,
        updated_at: Date.now(),
      },
    } as unknown as ReturnType<typeof goalWakeController.claimMissionTick>);
    const finish = vi.spyOn(goalWakeController, "finishMissionTick").mockReturnValue({
      ok: true,
      revision: 2,
      row: {
        mission_id: missionId,
        active_tick_id: null,
        last_wake_id: null,
        updated_at: Date.now(),
      },
    } as unknown as ReturnType<typeof goalWakeController.finishMissionTick>);

    const { deps, saves } = makeDeps();
    const result = await tickMission({ missionId, reason: "manual" }, missionConfig(), deps);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0]?.[0].activeTickId).toBe("mission_tick_mission-fenced-tick-wiring_1");
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[0].activeTickId).toBe(
      "mission_tick_mission-fenced-tick-wiring_1",
    );
    expect(result.status).toBe("complete");
    expect(saves.at(-1)?.activeTickId).toBeNull();
  });

  it("keeps the legacy tick path when mission fencing is disabled", async () => {
    const claim = vi.spyOn(goalWakeController, "claimMissionTick");
    const finish = vi.spyOn(goalWakeController, "finishMissionTick");

    const { deps, saves } = makeDeps();
    const result = await tickMission({ missionId, reason: "manual" }, missionConfig(), deps);

    expect(result.tick).toBe(1);
    expect(claim).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(saves.at(-1)?.tick).toBe(1);
  });

  it("carries one mission tick lineage through TaskLoop and SEKB evidence", async () => {
    const { deps, missions, runRequests } = makeDeps();
    const result = await tickMission({ missionId, reason: "manual" }, missionConfig(), deps);

    expect(runRequests[0]).toMatchObject({
      lineage: {
        schema: "runtime-lineage.v1",
        sessionId: "agent:agent-a:main",
        missionId,
        missionTick: 1,
      },
    });
    expect(result.lineage).toEqual({
      schema: "runtime-lineage.v1",
      sessionId: "agent:agent-a:main",
      missionId,
      missionTick: 1,
      loopRunId: "loop-1",
      traceId: "trace-1",
      taskLedgerRootId: "ledger-1",
    });
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: "trajectory-1", label: "SEKB task-loop trajectory" }),
      ]),
    );
    expect(result.ticks[0]?.lineage).toEqual(result.lineage);
    expect(missions.get(missionId)?.lineage).toEqual(result.lineage);
  });

  it("persists the production Mission-to-DCS lineage on the captured SEKB trajectory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tf0072-lineage-"));
    try {
      const store = new KnowledgeStore({ database: { path: path.join(root, "openclaw.sqlite") } });
      const capture = new TrajectoryCapture({ store });
      const writes: string[] = [];
      setTaskStateHandlerConfig(
        {
          sessionId: "agent:agent-a:main",
          objective: "prove fenced tick wiring",
          trajectoryCapture: capture,
          contextBlockSink: async (pending) => {
            writes.push(...pending.flatMap((write) => write.block.full_content ?? []));
            return pending.map(() => ({ accepted: true }));
          },
        },
        { sessionId: "agent:agent-a:main" },
      );

      const { deps } = makeDeps();
      deps.runTaskLoop = runTaskLoop;
      deps.taskLoopDeps = {
        idFactory: (prefix) => `${prefix}-tf0072`,
        ensureTaskLedgerRoot: async () => "ledger-tf0072",
        recordCheckpoint: () => undefined,
        storeTrace: () => undefined,
        runObserved: async () =>
          ({
            plan: {
              mode: "serial",
              leadRole: "developer",
              templateId: "quick-development",
              workers: [{ roleName: "developer" }],
            },
            outcomes: [
              {
                roleName: "developer",
                isVerifier: false,
                ledger: { taskId: "task-developer", taskNodeId: "task-developer" },
                spawn: {
                  status: "accepted",
                  result: { runId: "child-tf0072", childSessionKey: "agent:child:tf0072" },
                },
              },
            ],
            failures: [],
          }) as never,
        getSubagentRun: () =>
          ({
            runId: "child-tf0072",
            childSessionKey: "agent:child:tf0072",
            completion: {
              required: true,
              resultText: "Implemented runtime lineage.\nTests passed.",
              capturedAt: Date.now(),
            },
            outcome: { status: "ok" },
          }) as never,
        selfCheck: (async () => ({
          decision: "complete" as const,
          confidence: 1,
          missingEvidence: [],
          verificationGaps: [],
          risks: [],
          controlSignals: [],
          validationState: { status: "passed" as const, checks: [] },
          contextSummary: "runtime lineage complete",
        })) as NonNullable<TaskLoopControllerDeps["selfCheck"]>,
      };

      const result = await tickMission({ missionId, reason: "manual" }, missionConfig(), deps);
      const trajectoryRef = result.evidenceRefs.find(
        (ref) => ref.label === "SEKB task-loop trajectory",
      );
      expect(trajectoryRef).toBeDefined();
      expect(store.get_trajectory(trajectoryRef!.ref).metadata.runtimeLineage).toEqual(
        result.lineage,
      );
      expect(writes.map((content) => JSON.parse(content).lineage)).toContainEqual(result.lineage);
    } finally {
      closeOpenClawStateDatabaseForTest();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
