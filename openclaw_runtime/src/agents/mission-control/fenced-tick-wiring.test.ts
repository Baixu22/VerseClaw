import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { goalWakeController } from "../goal-wake-controller.js";
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

function makeDeps(): { deps: MissionControllerDeps; missions: Map<string, MissionRunRecord>; saves: MissionRunRecord[] } {
  const missions = new Map<string, MissionRunRecord>();
  missions.set(missionId, fixture());
  const saves: MissionRunRecord[] = [];
  const deps: MissionControllerDeps = {
    getMission: (id: string) => missions.get(id),
    saveMission: (record: MissionRunRecord) => {
      missions.set(record.missionId, record);
      saves.push({ ...record, ticks: [...record.ticks] });
      return record;
    },
    recordEvent: () => undefined,
    storeTrace: () => undefined,
    runTaskLoop: (async () => ({
      loopRunId: "loop-1",
      traceId: "trace-1",
      status: "complete" as const,
      finalSummary: "done",
      evidenceRefs: [],
      risks: [],
      remaining: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })) as unknown as NonNullable<MissionControllerDeps["runTaskLoop"]>,
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
  return { deps, missions, saves };
}

function missionConfig(): OpenClawConfig {
  return {
    agents: { defaults: { missionLoop: { enabled: true } } },
  } as unknown as OpenClawConfig;
}

afterEach(() => {
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
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
    expect(finish.mock.calls[0]?.[0].activeTickId).toBe("mission_tick_mission-fenced-tick-wiring_1");
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
});
