// TF-0084 owner path 2: projection / ledger / owner-registry set consistency.
//
// The reachability census proves a declared method is dispatchable. This file
// proves the other half of AC2: that the two read models and the owning
// registries describe the same set of records. Both projections are built from
// ONE owner snapshot, so a disagreement here is a real projection defect and not
// two reads that happened to observe different moments.
//
// The activity projection is deliberately bounded (4 goals / 8 processes / 8
// lineage rows) while the ledger keeps 64 entries, so "equal sets" is only
// asserted within those bounds; above them the projection must be the newest
// prefix of what the ledger reports, never an arbitrary subset.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addSession,
  listFinishedSessions,
  listRunningSessions,
  markExited,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "../../agents/bash-process-registry.js";
import { saveMissionRun } from "../../agents/mission-control/store.js";
import type { MissionRunRecord } from "../../agents/mission-control/types.js";
import {
  addSubagentRunForTests,
  listSubagentRunsForRequester,
  resetSubagentRegistryForTests,
  type SubagentRunRecord,
} from "../../agents/subagent-registry.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import type { SupervisorSessionRunSnapshot } from "../../process/supervisor/index.js";
import * as stateDb from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore } from "../../tasks/task-flow-cas.js";
import { buildSessionActivityReadProjection } from "./session-activity-projection.js";
import { buildSessionLifecycleLedger } from "./session-lifecycle-ledger.js";
import { collectSessionLifecycleOwnerViews } from "./session-lifecycle-owner-views.js";

type SeedDatabase = Pick<OpenClawStateKyselyDatabase, "task_runs">;

const SESSION_KEY = "agent:tf0084-consistency:main";
const FOREIGN_KEY = "agent:tf0084-consistency:other";
const GENERATION = "generation-consistency";
const BASE_AT = 1_770_100_000_000;
const tempRoots: string[] = [];

function missionFixture(): MissionRunRecord {
  return {
    missionId: "mission-consistency",
    sessionKey: SESSION_KEY,
    objective: "objective",
    acceptance: [],
    status: "sleeping",
    phase: "execute",
    tick: 1,
    repairTicks: 0,
    maxTicks: 8,
    maxRepairTicks: 3,
    progress: 0.25,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {},
    createdAt: BASE_AT - 30_000,
    updatedAt: BASE_AT - 25_000,
    ticks: [],
    activeTickId: null,
    lineage: { schema: "runtime-lineage.v1", sessionId: GENERATION },
  } as MissionRunRecord;
}

function seedFlow(flowId: string, ownerKey = SESSION_KEY) {
  const created = new TaskFlowCasStore().casUpsert({
    flowId,
    expectedRevision: -1,
    status: "waiting",
    ownerKey,
    controllerId: "goal-wake",
    waitJson: JSON.stringify({
      v: 1,
      turnBarrier: "acked",
      continuation: "mission_tick",
      missionId: "mission-consistency",
      sessionKey: ownerKey,
      dependency: { kind: "process", taskId: `task-${flowId}` },
      runId: `run-${flowId}`,
      ownerEpoch: "epoch-consistency",
    }),
  });
  expect(created.ok).toBe(true);
}

function seedTask(taskId: string, ownerKey = SESSION_KEY, lastEventAt = BASE_AT - 20_000) {
  stateDb.runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<SeedDatabase>(db);
    executeSqliteQuerySync(
      db,
      query.insertInto("task_runs").values({
        task_id: taskId,
        runtime: "process",
        task_kind: "goal-owned-process",
        source_id: `goal-wake:${taskId}`,
        requester_session_key: ownerKey,
        owner_key: ownerKey,
        scope_kind: "session",
        child_session_key: null,
        parent_flow_id: null,
        parent_task_id: null,
        agent_id: "tf0084",
        run_id: `run-${taskId}`,
        label: "goal-owned process",
        task: "task",
        status: "running",
        delivery_status: "notify",
        notify_policy: "done_only",
        created_at: BASE_AT - 22_000,
        started_at: BASE_AT - 21_000,
        ended_at: null,
        last_event_at: lastEventAt,
        cleanup_after: null,
        error: null,
        progress_summary: null,
        terminal_summary: null,
        terminal_outcome: null,
      }),
    );
  });
}

function bashFixture(id: string, startedAt: number, sessionKey = SESSION_KEY): ProcessSession {
  return {
    id,
    command: "cmd",
    sessionKey,
    lifecycleCanonicalSessionKey: sessionKey,
    lifecycleExpectedSessionId: GENERATION,
    startedAt,
    lastOutputAt: startedAt + 100,
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

function subagentFixture(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "sub-consistency",
    childSessionKey: "agent:tf0084-consistency:child",
    controllerSessionKey: SESSION_KEY,
    requesterSessionKey: SESSION_KEY,
    requesterSessionId: GENERATION,
    requesterDisplayKey: SESSION_KEY,
    task: "task",
    cleanup: "keep",
    createdAt: BASE_AT - 12_000,
    startedAt: BASE_AT - 11_000,
    endedAt: BASE_AT - 10_000,
    outcome: { status: "ok" },
    ...overrides,
  } as SubagentRunRecord;
}

function supervisorFixture(runId = "supervisor-consistency"): SupervisorSessionRunSnapshot {
  return {
    runId,
    pid: 4242,
    state: "running",
    lifecycleCanonicalSessionKey: SESSION_KEY,
    lifecycleExpectedSessionId: GENERATION,
    startedAtMs: BASE_AT - 9_000,
    updatedAtMs: BASE_AT - 8_000,
  };
}

/** Builds both read models from one owner snapshot. */
function readBoth(runs: SupervisorSessionRunSnapshot[] = [supervisorFixture()]) {
  const views = collectSessionLifecycleOwnerViews(SESSION_KEY, {
    supervisor: { snapshotRunsForSession: () => runs },
    goalLimit: 64,
    processLimit: 64,
  });
  return {
    views,
    projection: buildSessionActivityReadProjection(views),
    ledger: buildSessionLifecycleLedger({
      views,
      session: { sessionId: GENERATION, startedAt: BASE_AT - 40_000 },
      capturedAt: BASE_AT,
    }),
  };
}

function ledgerIds(
  ledger: ReturnType<typeof buildSessionLifecycleLedger>,
  owner: string,
): string[] {
  return ledger.entries
    .filter((entry) => entry.owner === owner)
    .map((entry) => entry.id.slice(owner.length + 1))
    .sort();
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-lifecycle-consistency-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  delete process.env.OPENCLAW_CONFIG_PATH;
});

afterEach(() => {
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

describe("projection, ledger and owner registry consistency", () => {
  it("reports exactly the owner records, with no invented and no dropped entry", () => {
    saveMissionRun(missionFixture());
    seedFlow("flow-consistency");
    seedTask("task-flow-consistency");
    addSession(bashFixture("bash-a", BASE_AT - 7_000));
    addSubagentRunForTests(subagentFixture());

    const { views, projection, ledger } = readBoth();

    // The owner snapshot is what the registries themselves report.
    expect(views.bashProcesses.map((session) => session.id)).toEqual(
      [...listRunningSessions(), ...listFinishedSessions()]
        .filter((session) => session.lifecycleCanonicalSessionKey === SESSION_KEY)
        .map((session) => session.id),
    );
    expect(views.lineageRuns.map((run) => run.runId)).toEqual(
      listSubagentRunsForRequester(SESSION_KEY).map((run) => run.runId),
    );

    // Ledger set == owner set, per owner.
    expect(ledgerIds(ledger, "missionRuns")).toEqual(["mission-consistency"]);
    expect(ledgerIds(ledger, "goalWakeFlow")).toEqual(views.flows.map((row) => row.flow_id));
    expect(ledgerIds(ledger, "goalOwnedTask")).toEqual(views.tasks.map((row) => row.task_id));
    expect(ledgerIds(ledger, "bashRegistry")).toEqual(
      views.bashProcesses.map((session) => session.id).sort(),
    );
    expect(ledgerIds(ledger, "processSupervisor")).toEqual(["supervisor-consistency"]);
    expect(ledgerIds(ledger, "subagentRegistry")).toEqual(["sub-consistency"]);

    // Projection set == the same owner set (both are within the projection bounds).
    expect(projection.goals.map((goal) => goal.id).sort()).toEqual(
      ["mission-consistency", "flow-consistency"].sort(),
    );
    expect(projection.processes.map((entry) => entry.id).sort()).toEqual(
      ["task-flow-consistency", "bash-a", "supervisor-consistency"].sort(),
    );
    expect(projection.lineage.map((entry) => entry.id)).toEqual(["sub-consistency"]);

    // Every projected record is also a ledger record: no read model shows a
    // resource the other one cannot account for.
    const ledgerRecordIds = new Set(
      ledger.entries.map((entry) => entry.id.slice(entry.owner.length + 1)),
    );
    for (const id of [
      ...projection.goals.map((goal) => goal.id),
      ...projection.processes.map((entry) => entry.id),
      ...projection.lineage.map((entry) => entry.id),
    ]) {
      expect(ledgerRecordIds.has(id)).toBe(true);
    }
    expect(ledger.census.unexplainedTransitions).toBe(0);
  });

  it("keeps a foreign session's owner records out of both read models", () => {
    seedFlow("flow-foreign", FOREIGN_KEY);
    seedTask("task-foreign", FOREIGN_KEY);
    addSession(bashFixture("bash-foreign", BASE_AT - 7_000, FOREIGN_KEY));
    addSubagentRunForTests(
      subagentFixture({ runId: "sub-foreign", requesterSessionKey: FOREIGN_KEY }),
    );

    const { projection, ledger } = readBoth([]);

    expect(ledger.entries.map((entry) => entry.owner)).toEqual(["sessionStore"]);
    expect(projection).toEqual({ goals: [], processes: [], lineage: [] });
  });

  it("never lists a reclaimed process in either read model", () => {
    const reclaimed = bashFixture("bash-reclaimed", BASE_AT - 7_000);
    addSession(reclaimed);
    expect(readBoth([]).ledger.entries.some((entry) => entry.owner === "bashRegistry")).toBe(true);

    // TF-0081 boundary: once the owning registry has dropped the record, neither
    // read model may keep projecting it.
    resetProcessRegistryForTests();

    const after = readBoth([]);
    expect(after.views.bashProcesses).toEqual([]);
    expect(after.ledger.entries.some((entry) => entry.owner === "bashRegistry")).toBe(false);
    expect(after.projection.processes).toEqual([]);
  });

  it("bounds the projection to its newest rows while the ledger keeps the rest", () => {
    // Ten owner records against a projection bound of eight: the omission must be
    // the declared bound applied by recency, not an arbitrary subset.
    const ids = Array.from({ length: 10 }, (_, index) => `bash-${String(index).padStart(2, "0")}`);
    for (const [index, id] of ids.entries()) {
      addSession(bashFixture(id, BASE_AT - 10_000 + index * 100));
    }

    const { projection, ledger } = readBoth([]);
    const newestEight = [...ids].reverse().slice(0, 8).sort();

    expect(ledgerIds(ledger, "bashRegistry")).toEqual([...ids].sort());
    expect(projection.processes.map((entry) => entry.id).sort()).toEqual(newestEight);
    // The two records the projection omits are exactly the oldest two.
    const projected = new Set(projection.processes.map((entry) => entry.id));
    expect(ids.filter((id) => !projected.has(id))).toEqual(ids.slice(0, 2));
  });

  it("agrees on the status of the same owner record", () => {
    const finished = bashFixture("bash-finished", BASE_AT - 7_000);
    addSession(finished);
    markExited(finished, 0, null, "completed");

    const { projection, ledger } = readBoth([]);

    // The ledger reports the owner's raw token; the projection maps it for the UI.
    // Both must come from the same owner record, so the pair is fixed.
    expect(ledger.entries.find((entry) => entry.owner === "bashRegistry")).toMatchObject({
      transition: "completed",
    });
    expect(projection.processes.find((entry) => entry.id === "bash-finished")).toMatchObject({
      status: "completed",
    });
  });
});
