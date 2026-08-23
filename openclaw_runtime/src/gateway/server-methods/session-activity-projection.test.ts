import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addSession,
  markBackgrounded,
  markExited,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "../../agents/bash-process-registry.js";
import { saveMissionRun, type MissionRunRecord } from "../../agents/mission-control/store.js";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
  type SubagentRunRecord,
} from "../../agents/subagent-registry.js";
import * as processRegistry from "../../agents/bash-process-registry.js";
import * as sessionStore from "../../config/sessions/store.js";
import * as sessionStoreSqlite from "../../config/sessions/store-sqlite.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import * as stateDb from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import { createProcessSupervisor, type SupervisorSessionRunSnapshot } from "../../process/supervisor/index.js";
import { TaskFlowCasStore } from "../../tasks/task-flow-cas.js";
import { collectSessionActivityReadProjection } from "./session-activity-projection.js";

type SeedDatabase = Pick<OpenClawStateKyselyDatabase, "task_runs">;

const SESSION_KEY = "agent:phase5:main";
const tempRoots: string[] = [];
let stateDir = "";

function missionFixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: "mission-phase5",
    sessionKey: SESSION_KEY,
    objective: "RAW OBJECTIVE MUST NEVER LEAVE THE READ MODEL",
    acceptance: [],
    status: "sleeping",
    phase: "execute",
    tick: 3,
    repairTicks: 0,
    maxTicks: 8,
    maxRepairTicks: 3,
    progress: 0.42,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {},
    createdAt: now - 10_000,
    updatedAt: now,
    ticks: [],
    activeTickId: null,
    ...overrides,
  };
}

function seedFlow(input: {
  flowId: string;
  status: "queued" | "waiting" | "failed";
  waitJson: string | null;
}) {
  const cas = new TaskFlowCasStore();
  const created = cas.casUpsert({
    flowId: input.flowId,
    expectedRevision: -1,
    status: input.status === "failed" ? "waiting" : input.status,
    ownerKey: SESSION_KEY,
    controllerId: "goal-wake",
    waitJson: input.waitJson,
  });
  expect(created.ok).toBe(true);
  if (input.status === "failed") {
    const failed = cas.casUpsert({
      flowId: input.flowId,
      expectedRevision: 0,
      status: "failed",
      waitJson: input.waitJson,
    });
    expect(failed.ok).toBe(true);
  }
}

function seedTask(input: {
  taskId: string;
  status: "queued" | "running" | "succeeded" | "timed_out";
  label: string;
  task: string;
  endedAt?: number;
  lastEventAt?: number;
}) {
  stateDb.runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<SeedDatabase>(db);
    executeSqliteQuerySync(db, query.insertInto("task_runs").values({
      task_id: input.taskId,
      runtime: "process",
      task_kind: "goal-owned-process",
      source_id: `goal-wake:${input.taskId}`,
      requester_session_key: SESSION_KEY,
      owner_key: SESSION_KEY,
      scope_kind: "session",
      child_session_key: null,
      parent_flow_id: null,
      parent_task_id: null,
      agent_id: "phase5",
      run_id: `run-${input.taskId}`,
      label: input.label,
      task: input.task,
      status: input.status,
      delivery_status: "notify",
      notify_policy: "done_only",
      created_at: Date.now() - 6_000,
      started_at: Date.now() - 5_000,
      ended_at: input.endedAt ?? null,
      last_event_at: input.lastEventAt ?? Date.now() - 500,
      cleanup_after: null,
      error: "RAW ERROR SECRET",
      progress_summary: null,
      terminal_summary: null,
      terminal_outcome: null,
    }));
  });
}

function runningProcessFixture(id: string): ProcessSession {
  const now = Date.now();
  return {
    id,
    command: "RAW COMMAND SECRET --token=supersecret",
    sessionKey: SESSION_KEY,
    lifecycleCanonicalSessionKey: SESSION_KEY,
    cwd: "C:/SECRET/CWD",
    pid: 4242,
    startedAt: now - 4_000,
    lastOutputAt: now - 2_000,
    maxOutputChars: 1_000,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exitCode: null,
    exitSignal: null,
    exited: false,
    truncated: false,
    backgrounded: true,
  } as unknown as ProcessSession;
}

function lineageFixture(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  const now = Date.now();
  return {
    runId: "sub-phase5",
    childSessionKey: "agent:phase5:child",
    controllerSessionKey: SESSION_KEY,
    requesterSessionKey: SESSION_KEY,
    requesterDisplayKey: SESSION_KEY,
    task: "RAW CHILD TASK SECRET",
    taskName: "explorer",
    cleanup: "keep",
    label: "explorer",
    createdAt: now - 5_000,
    startedAt: now - 4_000,
    endedAt: now - 1_000,
    outcome: { status: "ok" },
    orchestration: { roleName: "explorer" },
    ...overrides,
  } as SubagentRunRecord;
}

function supervisorFixture(overrides: Partial<SupervisorSessionRunSnapshot> = {}): SupervisorSessionRunSnapshot {
  const now = Date.now();
  return {
    runId: "supervisor-phase5",
    pid: 99,
    state: "running",
    lifecycleCanonicalSessionKey: SESSION_KEY,
    startedAtMs: now - 3_000,
    updatedAtMs: now - 1_000,
    ...overrides,
  };
}

function collectWithSupervisor(mission: MissionRunRecord, runs: SupervisorSessionRunSnapshot[]) {
  return collectSessionActivityReadProjection(SESSION_KEY, mission, {
    supervisor: { snapshotRunsForSession: () => runs },
  });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-activity-projection-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  delete process.env.OPENCLAW_CONFIG_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetProcessRegistryForTests();
  resetSubagentRegistryForTests({ persist: false });
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows WAL close race; test evidence does not depend on cleanup.
    }
  }
});

describe("session activity read projection", () => {
  it("projects mission, flow, process, supervisor, and lineage without raw text", () => {
    const mission = missionFixture();
    saveMissionRun(mission);
    seedFlow({
      flowId: "flow-phase5",
      status: "waiting",
      waitJson: JSON.stringify({
        v: 1,
        turnBarrier: "acked",
        continuation: "mission_tick",
        missionId: mission.missionId,
        sessionKey: SESSION_KEY,
        dependency: { kind: "process", taskId: "task-phase5" },
        commandDigest: "sha256:abc1234567890abcdef1234567890abcdef",
      }),
    });
    seedTask({
      taskId: "task-phase5",
      status: "running",
      label: "goal-owned process abc1234567890abc",
      task: "goal-owned process (sha256:abc1234567890abcdef1234567890abcdef)",
    });

    addSession(runningProcessFixture("bash-phase5"));
    const finished = runningProcessFixture("bash-phase5-finished");
    addSession(finished);
    markExited(finished, 0, null, "completed");

    addSubagentRunForTests(lineageFixture());
    addSubagentRunForTests(lineageFixture({
      runId: "parent-phase5",
      childSessionKey: SESSION_KEY,
      requesterSessionKey: "agent:phase5:parent",
    }));

    const projection = collectWithSupervisor(mission, [supervisorFixture()]);

    expect(projection.goals.map((goal) => goal.kind).sort()).toEqual(["flow", "mission"]);
    expect(projection.goals.find((goal) => goal.kind === "mission")).toMatchObject({
      id: "mission-phase5",
      status: "sleeping",
      progress: 0.42,
      phase: "execute",
    });
    const flow = projection.goals.find((goal) => goal.kind === "flow");
    expect(flow).toMatchObject({ id: "flow-phase5", status: "waiting" });
    expect(flow?.digest).toBe("sha256:abc1234567890abcdef1234567890abcdef");

    expect(projection.processes.map((process) => process.kind).sort()).toEqual([
      "bash",
      "bash",
      "goalOwned",
      "supervisor",
    ]);
    expect(projection.processes.find((process) => process.id === "task-phase5")).toMatchObject({
      kind: "goalOwned",
      status: "running",
      digest: "abc1234567890abc",
    });
    expect(projection.processes.find((process) => process.id === "bash-phase5")).toMatchObject({
      kind: "bash",
      status: "running",
      pid: 4242,
    });
    expect(projection.processes.find((process) => process.id === "bash-phase5-finished")?.status).toBe("completed");

    expect(projection.lineage.map((entry) => entry.kind).sort()).toEqual(["child", "parent"]);
    expect(projection.lineage.find((entry) => entry.kind === "child")).toMatchObject({
      id: "sub-phase5",
      sessionKey: "agent:phase5:child",
      role: "explorer",
      status: "completed",
    });

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("RAW OBJECTIVE MUST NEVER LEAVE THE READ MODEL");
    expect(serialized).not.toContain("RAW COMMAND SECRET");
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("RAW ERROR SECRET");
    expect(serialized).not.toContain("RAW CHILD TASK SECRET");
    expect(serialized).not.toContain("C:/SECRET/CWD");
  });

  it("stays consistent with the owner registry: idle classification matches and recycled records never appear", () => {
    const now = Date.now();
    // Running with fresh output -> running-process.
    addSession(runningProcessFixture("bash-fresh"));
    // Running with stale output (beyond the default 10min window) -> idle.
    const stale = runningProcessFixture("bash-stale");
    stale.startedAt = now - 60 * 60 * 1000;
    stale.lastOutputAt = now - 59 * 60 * 1000;
    addSession(stale);
    // Finished backgrounded record -> completed, no idle classification.
    const finished = runningProcessFixture("bash-done");
    addSession(finished);
    markBackgrounded(finished);
    markExited(finished, 0, null, "completed");
    // Reclaimed (drain-swept) record must never be projected.
    const reclaimed = runningProcessFixture("bash-reclaimed");
    addSession(reclaimed);
    processRegistry.deleteSession(reclaimed.id);
    // Foreign identity must never leak into this session's projection.
    const foreign = runningProcessFixture("bash-foreign");
    foreign.sessionKey = "agent:other:main";
    foreign.lifecycleCanonicalSessionKey = "agent:other:main";
    addSession(foreign);

    const projection = collectSessionActivityReadProjection(SESSION_KEY);

    const bashEntries = projection.processes.filter((process) => process.kind === "bash");
    expect(bashEntries.map((process) => process.id).sort()).toEqual([
      "bash-done",
      "bash-fresh",
      "bash-stale",
    ]);
    expect(bashEntries.find((process) => process.id === "bash-fresh")).toMatchObject({
      status: "running",
      idleClassification: "running-process",
    });
    expect(bashEntries.find((process) => process.id === "bash-stale")).toMatchObject({
      status: "running",
      idleClassification: "idle",
    });
    const done = bashEntries.find((process) => process.id === "bash-done");
    expect(done).toMatchObject({ status: "completed" });
    expect(done?.idleClassification).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain("bash-reclaimed");
    expect(JSON.stringify(projection)).not.toContain("bash-foreign");
  });

  it("maps terminal goal/process/lineage states and malformed wait json safely", () => {
    const mission = missionFixture({ status: "cancelled" });
    saveMissionRun(mission);
    seedFlow({ flowId: "flow-lost", status: "failed", waitJson: "not-json" });
    seedTask({
      taskId: "task-timed-out",
      status: "timed_out",
      label: "timed out process",
      task: "goal-owned process (sha256:1111222233334444555566667777888899990000)",
      endedAt: Date.now() - 100,
      lastEventAt: Date.now() - 100,
    });
    const finished = runningProcessFixture("bash-terminal");
    addSession(finished);
    markExited(finished, 0, null, "completed");
    addSubagentRunForTests(lineageFixture({
      runId: "child-failed",
      outcome: { status: "error" },
      endedReason: undefined,
      endedAt: Date.now() - 100,
    }));
    addSubagentRunForTests(lineageFixture({
      runId: "child-aborted",
      endedReason: "killed",
      outcome: { status: "error" },
      endedAt: Date.now() - 100,
    }));

    const projection = collectWithSupervisor(mission, [
      supervisorFixture({
        runId: "supervisor-exiting",
        state: "exiting",
        updatedAtMs: Date.now(),
      }),
    ]);

    expect(projection.goals.find((goal) => goal.kind === "mission")?.status).toBe("aborted");
    expect(projection.goals.find((goal) => goal.id === "flow-lost")).toMatchObject({
      status: "failed",
      digest: undefined,
    });
    expect(projection.processes.find((process) => process.id === "task-timed-out")?.status).toBe("failed");
    expect(projection.processes.find((process) => process.id === "supervisor-exiting")?.status).toBe("exiting");
    expect(projection.lineage.find((entry) => entry.id === "child-failed")?.status).toBe("error");
    expect(projection.lineage.find((entry) => entry.id === "child-aborted")?.status).toBe("aborted");
  });

  it("returns stable empty projections for blank, missing, and terminal-only sessions", () => {
    expect(collectSessionActivityReadProjection("")).toEqual({ goals: [], processes: [], lineage: [] });
    expect(collectSessionActivityReadProjection("agent:phase5:missing")).toEqual({
      goals: [],
      processes: [],
      lineage: [],
    });
  });

  it("joins mission, goal-wake flow, and goal-owned process through one lineage ref", () => {
    const mission = missionFixture({ taskLoopRunId: "loop-run-phase5" });
    saveMissionRun(mission);
    seedFlow({
      flowId: "flow-join",
      status: "waiting",
      waitJson: JSON.stringify({
        v: 1,
        turnBarrier: "acked",
        continuation: "mission_tick",
        missionId: mission.missionId,
        sessionKey: SESSION_KEY,
        dependency: { kind: "process", taskId: "task-join" },
        commandDigest: "sha256:abc1234567890abcdef1234567890abcdef",
        runId: "durable-run-join",
        ownerEpoch: "epoch-join",
      }),
    });
    seedTask({
      taskId: "task-join",
      status: "running",
      label: "goal-owned process abc1234567890abc",
      task: "goal-owned process (sha256:abc1234567890abcdef1234567890abcdef)",
    });

    const projection = collectSessionActivityReadProjection(SESSION_KEY, mission);

    const missionGoal = projection.goals.find((goal) => goal.kind === "mission");
    const flowGoal = projection.goals.find((goal) => goal.kind === "flow");
    const process = projection.processes.find((entry) => entry.id === "task-join");

    expect(missionGoal?.lineage).toEqual({
      missionId: "mission-phase5",
      runId: "loop-run-phase5",
    });
    expect(flowGoal?.lineage).toEqual({
      missionId: "mission-phase5",
      runId: "durable-run-join",
      ownerEpoch: "epoch-join",
    });
    // The goal-owned process resolves to the same mission through the flow's
    // dependency task id — that join is the point of this slice.
    expect(process?.lineage).toEqual({
      missionId: "mission-phase5",
      runId: "run-task-join",
      ownerEpoch: "epoch-join",
      parentSessionKey: SESSION_KEY,
    });
    expect(new Set([missionGoal, flowGoal, process].map((entry) => entry?.lineage?.missionId))).toEqual(
      new Set(["mission-phase5"]),
    );
  });

  it("carries the mission lineage session pin when the mission records one", () => {
    const mission = missionFixture({
      lineage: {
        schema: "runtime-lineage.v1",
        sessionId: "session-generation-7",
        missionId: "mission-phase5",
        loopRunId: "loop-run-from-lineage",
      },
      taskLoopRunId: "loop-run-fallback",
    });
    saveMissionRun(mission);

    const projection = collectSessionActivityReadProjection(SESSION_KEY, mission);

    expect(projection.goals.find((goal) => goal.kind === "mission")?.lineage).toEqual({
      missionId: "mission-phase5",
      sessionId: "session-generation-7",
      runId: "loop-run-from-lineage",
    });
  });

  it("surfaces the spawn-time parent generation pin on lineage rows", () => {
    addSubagentRunForTests(lineageFixture({
      runId: "child-pinned",
      requesterSessionId: "session-generation-1",
    }));
    addSubagentRunForTests(lineageFixture({
      runId: "child-legacy",
      childSessionKey: "agent:phase5:child-legacy",
      requesterSessionId: undefined,
    }));

    const projection = collectSessionActivityReadProjection(SESSION_KEY);

    expect(projection.lineage.find((entry) => entry.id === "child-pinned")?.lineage).toEqual({
      runId: "child-pinned",
      parentSessionKey: SESSION_KEY,
      sessionId: "session-generation-1",
    });
    // A legacy unpinned run keeps its run/parent join but claims no generation.
    expect(projection.lineage.find((entry) => entry.id === "child-legacy")?.lineage).toEqual({
      runId: "child-legacy",
      parentSessionKey: SESSION_KEY,
    });
  });

  it("gives every projected effect the identity its owner records", () => {
    const mission = missionFixture({ taskLoopRunId: "loop-run-complete" });
    saveMissionRun(mission);
    seedFlow({
      flowId: "flow-complete",
      status: "waiting",
      waitJson: JSON.stringify({
        v: 1,
        turnBarrier: "acked",
        continuation: "mission_tick",
        missionId: mission.missionId,
        sessionKey: SESSION_KEY,
        dependency: { kind: "process", taskId: "task-complete" },
        runId: "durable-run-complete",
        ownerEpoch: "epoch-complete",
      }),
    });
    seedTask({
      taskId: "task-complete",
      status: "running",
      label: "goal-owned process",
      task: "goal-owned process (sha256:1111222233334444555566667777888899990000)",
    });
    const bash = runningProcessFixture("bash-complete");
    bash.lifecycleExpectedSessionId = "session-generation-3";
    addSession(bash);
    addSubagentRunForTests(lineageFixture({
      runId: "child-complete",
      requesterSessionId: "session-generation-3",
    }));

    const projection = collectWithSupervisor(mission, [
      supervisorFixture({
        runId: "supervisor-complete",
        lifecycleExpectedSessionId: "session-generation-3",
      }),
    ]);

    const entries = [...projection.goals, ...projection.processes, ...projection.lineage];
    expect(entries.length).toBeGreaterThan(0);
    const unjoined = entries.filter(
      (entry) => !entry.lineage || Object.keys(entry.lineage).length === 0,
    );
    expect(unjoined).toEqual([]);
    expect(projection.processes.find((entry) => entry.id === "bash-complete")?.lineage).toEqual({
      sessionId: "session-generation-3",
    });
    expect(projection.processes.find((entry) => entry.id === "supervisor-complete")?.lineage).toEqual({
      runId: "supervisor-complete",
      sessionId: "session-generation-3",
    });
    console.log(`[runtime-lifecycle-audit] lineageUnjoinedEntries=${unjoined.length}`);
  });

  it("reports a yielded run as yielded instead of an error", () => {
    // markSubagentRunPausedAfterYield sets endedAt and clears outcome/endedReason.
    addSubagentRunForTests(lineageFixture({
      runId: "child-yielded",
      endedAt: Date.now() - 100,
      outcome: undefined,
      endedReason: undefined,
      pauseReason: "sessions_yield",
    }));

    const projection = collectSessionActivityReadProjection(SESSION_KEY);

    expect(projection.lineage.find((entry) => entry.id === "child-yielded")?.status).toBe("yielded");
  });

  it("drops unbounded lineage ids instead of projecting them", () => {
    const oversized = "x".repeat(300);
    addSubagentRunForTests(lineageFixture({
      runId: "child-bounded",
      requesterSessionId: oversized,
    }));

    const projection = collectSessionActivityReadProjection(SESSION_KEY);

    const entry = projection.lineage.find((row) => row.id === "child-bounded");
    expect(entry?.lineage).toEqual({
      runId: "child-bounded",
      parentSessionKey: SESSION_KEY,
    });
    expect(JSON.stringify(projection)).not.toContain(oversized);
  });

  it("keeps activitySnapshotWriteFindings=0 when the snapshot repeats without write API calls", () => {
    const mission = missionFixture();
    saveMissionRun(mission);
    seedFlow({
      flowId: "flow-seeded",
      status: "waiting",
      waitJson: JSON.stringify({
        v: 1,
        turnBarrier: "acked",
        continuation: "mission_tick",
        missionId: mission.missionId,
        sessionKey: SESSION_KEY,
        dependency: { kind: "process", taskId: "task-seeded" },
        commandDigest: "sha256:1111222233334444555566667777888899990000",
      }),
    });
    seedTask({
      taskId: "task-seeded",
      status: "succeeded",
      label: "seeded process",
      task: "goal-owned process (sha256:1111222233334444555566667777888899990000)",
      endedAt: Date.now() - 100,
      lastEventAt: Date.now() - 100,
    });
    addSession(runningProcessFixture("bash-seeded"));

    const supervisor = createProcessSupervisor();
    const writeSpies = [
      vi.spyOn(stateDb, "runOpenClawStateWriteTransaction"),
      vi.spyOn(sessionStore, "saveSessionStore"),
      vi.spyOn(sessionStore, "updateSessionStore"),
      vi.spyOn(sessionStore, "upsertSessionEntry"),
      vi.spyOn(sessionStore, "applySessionStoreEntryPatch"),
      vi.spyOn(sessionStoreSqlite, "replaceSqliteSessionStore"),
      vi.spyOn(sessionStoreSqlite, "writeSessionDeleteOperationJournalRow"),
      vi.spyOn(processRegistry, "addSession"),
      vi.spyOn(processRegistry, "deleteSession"),
      vi.spyOn(processRegistry, "markExited"),
      vi.spyOn(supervisor, "spawn"),
      vi.spyOn(supervisor, "cancel"),
      vi.spyOn(supervisor, "cancelScope"),
      vi.spyOn(supervisor, "drainRunsForLifecycle"),
    ];

    const first = collectSessionActivityReadProjection(SESSION_KEY, mission, { supervisor });
    const second = collectSessionActivityReadProjection(SESSION_KEY, mission, { supervisor });

    expect(first).toEqual(second);
    expect(first.goals.find((goal) => goal.id === "flow-seeded")).toMatchObject({
      kind: "flow",
      status: "waiting",
      digest: "sha256:1111222233334444555566667777888899990000",
    });
    expect(first.processes.find((process) => process.id === "task-seeded")).toMatchObject({
      kind: "goalOwned",
      status: "completed",
    });

    const findings = writeSpies.filter((spy) => spy.mock.calls.length > 0).length;
    expect(findings).toBe(0);
    console.log(`[runtime-lifecycle-audit] activitySnapshotWriteFindings=${findings}`);
  });
});
