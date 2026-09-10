// TF-0084 owner path 1: lifecycle ledger tests.
//
// The fixtures seed real owner stores (SQLite `flow_runs`/`task_runs`, the bash
// process registry, the subagent registry, the mission store) rather than mocking
// the read layer, so a passing assertion is evidence the owners really record
// what the ledger reports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addSession,
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
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import type { SupervisorSessionRunSnapshot } from "../../process/supervisor/index.js";
import * as stateDb from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore } from "../../tasks/task-flow-cas.js";
import {
  buildSessionLifecycleLedgerCensus,
  collectSessionLifecycleLedger,
  type SessionLifecycleLedgerEntry,
} from "./session-lifecycle-ledger.js";

type SeedDatabase = Pick<OpenClawStateKyselyDatabase, "task_runs">;

const SESSION_KEY = "agent:tf0084:main";
const GENERATION = "session-generation-a";
const CAPTURED_AT = 1_770_000_000_000;
const tempRoots: string[] = [];

function missionFixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
  return {
    missionId: "mission-tf0084",
    sessionKey: SESSION_KEY,
    objective: "RAW OBJECTIVE MUST NEVER LEAVE THE READ MODEL",
    acceptance: [],
    status: "sleeping",
    phase: "execute",
    tick: 2,
    repairTicks: 0,
    maxTicks: 8,
    maxRepairTicks: 3,
    progress: 0.5,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {},
    createdAt: CAPTURED_AT - 20_000,
    updatedAt: CAPTURED_AT - 10_000,
    ticks: [],
    activeTickId: null,
    lineage: { sessionId: GENERATION, loopRunId: "loop-tf0084" },
    ...overrides,
  } as MissionRunRecord;
}

function seedFlow(waitJson: string | null) {
  const cas = new TaskFlowCasStore();
  const created = cas.casUpsert({
    flowId: "flow-tf0084",
    expectedRevision: -1,
    status: "waiting",
    ownerKey: SESSION_KEY,
    controllerId: "goal-wake",
    waitJson,
  });
  expect(created.ok).toBe(true);
}

function seedTask() {
  stateDb.runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<SeedDatabase>(db);
    executeSqliteQuerySync(
      db,
      query.insertInto("task_runs").values({
        task_id: "task-tf0084",
        runtime: "process",
        task_kind: "goal-owned-process",
        source_id: "goal-wake:task-tf0084",
        requester_session_key: SESSION_KEY,
        owner_key: SESSION_KEY,
        scope_kind: "session",
        child_session_key: null,
        parent_flow_id: null,
        parent_task_id: null,
        agent_id: "tf0084",
        run_id: "run-task-tf0084",
        label: "goal-owned process",
        task: "RAW TASK SECRET (sha256:abc1234567890abcdef1234567890abcdef)",
        status: "running",
        delivery_status: "notify",
        notify_policy: "done_only",
        created_at: CAPTURED_AT - 18_000,
        started_at: CAPTURED_AT - 17_000,
        ended_at: null,
        last_event_at: CAPTURED_AT - 9_000,
        cleanup_after: null,
        error: "RAW ERROR SECRET",
        progress_summary: null,
        terminal_summary: null,
        terminal_outcome: null,
      }),
    );
  });
}

function bashFixture(id: string, overrides: Partial<ProcessSession> = {}): ProcessSession {
  return {
    id,
    command: "RAW COMMAND SECRET --token=supersecret",
    sessionKey: SESSION_KEY,
    lifecycleCanonicalSessionKey: SESSION_KEY,
    lifecycleExpectedSessionId: GENERATION,
    cwd: "C:/SECRET/CWD",
    pid: 4242,
    startedAt: CAPTURED_AT - 8_000,
    lastOutputAt: CAPTURED_AT - 7_000,
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
    ...overrides,
  } as unknown as ProcessSession;
}

function subagentFixture(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "sub-tf0084",
    childSessionKey: "agent:tf0084:child",
    controllerSessionKey: SESSION_KEY,
    requesterSessionKey: SESSION_KEY,
    requesterSessionId: GENERATION,
    requesterDisplayKey: SESSION_KEY,
    task: "RAW CHILD TASK SECRET",
    cleanup: "keep",
    label: "explorer",
    createdAt: CAPTURED_AT - 6_000,
    startedAt: CAPTURED_AT - 5_000,
    endedAt: CAPTURED_AT - 4_000,
    outcome: { status: "ok" },
    ...overrides,
  } as SubagentRunRecord;
}

function supervisorFixture(
  overrides: Partial<SupervisorSessionRunSnapshot> = {},
): SupervisorSessionRunSnapshot {
  return {
    runId: "supervisor-tf0084",
    pid: 99,
    state: "running",
    lifecycleCanonicalSessionKey: SESSION_KEY,
    lifecycleExpectedSessionId: GENERATION,
    startedAtMs: CAPTURED_AT - 3_500,
    updatedAtMs: CAPTURED_AT - 3_000,
    ...overrides,
  };
}

const WAIT_JSON = JSON.stringify({
  v: 1,
  turnBarrier: "acked",
  continuation: "mission_tick",
  missionId: "mission-tf0084",
  sessionKey: SESSION_KEY,
  dependency: { kind: "process", taskId: "task-tf0084" },
  runId: "run-task-tf0084",
  ownerEpoch: "epoch-tf0084",
  commandDigest: "sha256:abc1234567890abcdef1234567890abcdef",
});

function collect(
  options: Parameters<typeof collectSessionLifecycleLedger>[1] = {},
  runs: SupervisorSessionRunSnapshot[] = [supervisorFixture()],
) {
  return collectSessionLifecycleLedger(SESSION_KEY, {
    session: { sessionId: GENERATION, startedAt: CAPTURED_AT - 30_000 },
    supervisor: { snapshotRunsForSession: () => runs },
    capturedAt: CAPTURED_AT,
    ...options,
  });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-lifecycle-ledger-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
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

describe("session lifecycle ledger", () => {
  it("joins every owner into one ordered ledger with no unexplained transition", () => {
    const mission = missionFixture();
    saveMissionRun(mission);
    seedFlow(WAIT_JSON);
    seedTask();
    addSession(bashFixture("bash-tf0084"));
    addSubagentRunForTests(subagentFixture());

    const ledger = collect({ mission });

    expect(ledger.sessionKey).toBe(SESSION_KEY);
    expect(ledger.sessionId).toBe(GENERATION);
    expect(ledger.census.byOwner).toEqual({
      sessionStore: 1,
      missionRuns: 1,
      goalWakeFlow: 1,
      goalOwnedTask: 1,
      bashRegistry: 1,
      processSupervisor: 1,
      subagentRegistry: 1,
    });
    expect(ledger.census).toMatchObject({
      total: 7,
      unexplainedTransitions: 0,
      unjoinedEntries: 0,
      pinnedTransitions: 5,
      explainedTransitions: 2,
    });
    // Oldest first, so a reader follows the lifecycle forward.
    expect(ledger.entries.map((entry) => entry.at)).toEqual(
      [...ledger.entries.map((entry) => entry.at)].sort((left, right) => left - right),
    );
    expect(ledger.entries.every((entry) => entry.transition.length > 0)).toBe(true);
  });

  it("copies a pinned generation verbatim from each owner that records one", () => {
    const mission = missionFixture();
    saveMissionRun(mission);
    addSession(bashFixture("bash-tf0084"));
    addSubagentRunForTests(subagentFixture());

    const byOwner = new Map(collect({ mission }).entries.map((entry) => [entry.owner, entry]));

    for (const owner of [
      "sessionStore",
      "missionRuns",
      "bashRegistry",
      "processSupervisor",
      "subagentRegistry",
    ] as const) {
      expect(byOwner.get(owner)).toMatchObject({
        generation: GENERATION,
        generationSource: "owner-pinned",
      });
    }
  });

  it("declares the structural reason for owners that record no generation", () => {
    seedFlow(WAIT_JSON);
    seedTask();

    const entries = collect({ mission: undefined }, []).entries;
    const flow = entries.find((entry) => entry.owner === "goalWakeFlow");
    const task = entries.find((entry) => entry.owner === "goalOwnedTask");

    // `flow_runs.wait_json` and `task_runs` record mission/run/epoch but no
    // session generation, so neither may borrow one from another owner.
    expect(flow).toMatchObject({ generationSource: "owner-records-no-generation" });
    expect(task).toMatchObject({ generationSource: "owner-records-no-generation" });
    expect(flow?.generation).toBeUndefined();
    expect(task?.generation).toBeUndefined();
    // The correlation ref still joins them to the mission and durable epoch.
    expect(flow?.lineage).toMatchObject({
      missionId: "mission-tf0084",
      runId: "run-task-tf0084",
      ownerEpoch: "epoch-tf0084",
    });
    expect(task?.lineage).toMatchObject({
      runId: "run-task-tf0084",
      missionId: "mission-tf0084",
      parentSessionKey: SESSION_KEY,
    });
  });

  it("reports a legacy record without a spawn-time pin as legacy-unpinned", () => {
    addSubagentRunForTests(subagentFixture({ requesterSessionId: undefined }));

    const entry = collect({ mission: undefined }, []).entries.find(
      (candidate) => candidate.owner === "subagentRegistry",
    );

    expect(entry).toMatchObject({ generationSource: "legacy-unpinned" });
    expect(entry?.generation).toBeUndefined();
  });

  it("declares the owners it cannot read instead of dropping them", () => {
    expect(collect({ mission: undefined }, []).declaredGaps).toEqual([
      {
        owner: "electronTerminal",
        subject: "terminal",
        reason: "owner-outside-runtime-process",
      },
      {
        owner: "durableHelperRunDir",
        subject: "helper",
        reason: "owner-not-session-indexed",
      },
    ]);
  });

  it("refuses a stale generation without reading a single owner", () => {
    const mission = missionFixture();
    saveMissionRun(mission);
    addSession(bashFixture("bash-tf0084"));
    let supervisorReads = 0;

    const ledger = collectSessionLifecycleLedger(SESSION_KEY, {
      session: { sessionId: GENERATION },
      expectedSessionId: "session-generation-b",
      supervisor: {
        snapshotRunsForSession: () => {
          supervisorReads += 1;
          return [supervisorFixture()];
        },
      },
      capturedAt: CAPTURED_AT,
    });

    expect(ledger).toMatchObject({
      reason: "generation-mismatch",
      sessionId: GENERATION,
      entries: [],
    });
    expect(ledger.census.total).toBe(0);
    expect(supervisorReads).toBe(0);
  });

  it("reads the matching generation normally", () => {
    addSession(bashFixture("bash-tf0084"));

    const ledger = collect({ expectedSessionId: GENERATION, mission: undefined }, []);

    expect(ledger.reason).toBeUndefined();
    expect(ledger.entries.some((entry) => entry.owner === "bashRegistry")).toBe(true);
  });

  it("degrades a throwing owner read to an omission, never a fabricated entry", () => {
    addSession(bashFixture("bash-tf0084"));

    const ledger = collectSessionLifecycleLedger(SESSION_KEY, {
      session: { sessionId: GENERATION },
      supervisor: {
        snapshotRunsForSession: () => {
          throw new Error("supervisor read failed");
        },
      },
      capturedAt: CAPTURED_AT,
    });

    expect(ledger.entries.some((entry) => entry.owner === "processSupervisor")).toBe(false);
    expect(ledger.entries.some((entry) => entry.owner === "bashRegistry")).toBe(true);
    expect(ledger.census.unexplainedTransitions).toBe(0);
  });

  it("drops an overlong correlation id rather than projecting it", () => {
    const overlong = "x".repeat(257);
    addSession(bashFixture("bash-tf0084", { lifecycleExpectedSessionId: overlong }));

    const entry = collect({ mission: undefined }, []).entries.find(
      (candidate) => candidate.owner === "bashRegistry",
    );

    expect(entry?.generation).toBeUndefined();
    expect(entry?.generationSource).toBe("legacy-unpinned");
    expect(entry?.lineage).toBeUndefined();
  });

  it("reports the owner's own terminal status token for a finished process", () => {
    const finished = bashFixture("bash-tf0084-finished");
    addSession(finished);
    markExited(finished, 0, null, "completed");

    const entry = collect({ mission: undefined }, []).entries.find(
      (candidate) => candidate.owner === "bashRegistry",
    );

    expect(entry).toMatchObject({ subject: "process", transition: "completed" });
  });

  it("never projects raw command, objective, task, or error text", () => {
    const mission = missionFixture();
    saveMissionRun(mission);
    seedFlow(WAIT_JSON);
    seedTask();
    addSession(bashFixture("bash-tf0084"));
    addSubagentRunForTests(subagentFixture());

    const serialized = JSON.stringify(collect({ mission }));

    for (const secret of [
      "RAW OBJECTIVE",
      "RAW COMMAND SECRET",
      "RAW TASK SECRET",
      "RAW ERROR SECRET",
      "RAW CHILD TASK SECRET",
      "supersecret",
      "SECRET/CWD",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("session lifecycle ledger census", () => {
  function entry(overrides: Partial<SessionLifecycleLedgerEntry>): SessionLifecycleLedgerEntry {
    return {
      id: "owner:record",
      owner: "bashRegistry",
      subject: "process",
      transition: "running",
      at: CAPTURED_AT,
      generationSource: "owner-pinned",
      generation: GENERATION,
      lineage: { sessionId: GENERATION },
      ...overrides,
    };
  }

  it("counts a pin claimed without a generation as unexplained", () => {
    const census = buildSessionLifecycleLedgerCensus([
      entry({ generation: undefined, generationSource: "owner-pinned" }),
    ]);

    expect(census).toMatchObject({
      total: 1,
      pinnedTransitions: 0,
      explainedTransitions: 0,
      unexplainedTransitions: 1,
    });
  });

  it("counts a no-generation declaration that carries one as unexplained", () => {
    const census = buildSessionLifecycleLedgerCensus([
      entry({ generationSource: "owner-records-no-generation" }),
    ]);

    expect(census.unexplainedTransitions).toBe(1);
    expect(census.explainedTransitions).toBe(0);
  });

  it("counts an entry with no correlation ref as unjoined", () => {
    const census = buildSessionLifecycleLedgerCensus([
      entry({ lineage: undefined, generation: undefined, generationSource: "legacy-unpinned" }),
    ]);

    expect(census).toMatchObject({
      unjoinedEntries: 1,
      explainedTransitions: 1,
      unexplainedTransitions: 0,
    });
  });
});
