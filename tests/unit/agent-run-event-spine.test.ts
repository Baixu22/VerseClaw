import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS,
  RuntimeTaskEventLogStore,
  appendAgentRunEvent,
  buildAgentRunEventFixture,
  buildArtifactRefFixture,
  buildExecutionPlanFixture,
  buildObservationV2Fixture,
  buildPolicyDecisionFixture,
  buildProcessHandleFixture,
  createAgentRunRetention,
  createRuntimeTaskEventLogSqliteStorage,
  replayAgentRunEventLogRecords,
  replayAgentRunEvents,
  type AgentRunEvent,
  type AgentRunPayload,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("UAS-01 persistent event spine", () => {
  it("deduplicates task-scoped effects and returns the first event", async () => {
    const store = new RuntimeTaskEventLogStore();
    const first = event("event-plan", null, "idem-plan", 2_000, buildExecutionPlanFixture());
    const duplicate = event(
      "event-plan-retry",
      null,
      "idem-plan",
      2_001,
      buildExecutionPlanFixture({ planId: "plan-retry" }),
    );
    let sideEffects = 0;

    const firstResult = await appendAgentRunEvent(store, first, {
      now: 2_000,
      onFirstAppend: () => {
        sideEffects += 1;
      },
    });
    const duplicateResult = await appendAgentRunEvent(store, duplicate, {
      now: 2_001,
      onFirstAppend: () => {
        sideEffects += 1;
      },
    });

    expect(firstResult).toMatchObject({ appended: true, duplicate: false, effectApplied: true });
    expect(duplicateResult).toMatchObject({
      appended: false,
      duplicate: true,
      effectApplied: false,
      event: { eventId: "event-plan" },
    });
    expect(sideEffects).toBe(1);
    expect(store.exportRecords().total).toBe(1);
  });

  it("replays plans, processes, observations, artifacts, and policy decisions with online parity", async () => {
    const store = new RuntimeTaskEventLogStore();
    const events = causalRunEvents();
    let onlineState;
    for (const item of events) {
      onlineState = (await appendAgentRunEvent(store, item, { now: 3_100 })).state;
    }

    const rawReplay = replayAgentRunEvents(events, { now: 3_100, runId: "run_1", taskId: "task_1" });
    const persistedReplay = replayAgentRunEventLogRecords(store.exportRecords().records, {
      now: 3_100,
      runId: "run_1",
      taskId: "task_1",
    });

    expect(rawReplay.diagnostics).toEqual([]);
    expect(persistedReplay.diagnostics).toEqual([]);
    expect(persistedReplay.state).toEqual(rawReplay.state);
    expect(onlineState).toEqual(rawReplay.state);
    expect(rawReplay.state.eventCount).toBe(5);
    expect(Object.keys(rawReplay.state.plans)).toEqual(["plan_1"]);
    expect(Object.keys(rawReplay.state.processHandles)).toEqual(["process_1"]);
    expect(Object.keys(rawReplay.state.observations)).toEqual(["observation_1"]);
    expect(Object.keys(rawReplay.state.artifacts)).toEqual(["artifact_1"]);
    expect(Object.keys(rawReplay.state.policyDecisions)).toEqual(["decision_1"]);
  });

  it("persists sanitized events through the existing SQLite owner and reopens them", async () => {
    const dbPath = createTempDbPath();
    const plaintext = "sqlite-secret-canary-456";
    const timestamp = 4_000;
    const store = sqliteStore(dbPath);
    const plan = buildExecutionPlanFixture({
      envDelta: {
        allowlistedSet: { AUTHORIZATION: plaintext },
        unset: [],
        pathPrepend: [],
      },
      retention: createAgentRunRetention(timestamp),
    });
    const input = event("event-sqlite", null, "idem-sqlite", timestamp, plan);

    expect(await appendAgentRunEvent(store, input, { now: timestamp }))
      .toMatchObject({ appended: true, duplicate: false });
    closeOpenClawStateDatabaseForTest();

    const reopened = sqliteStore(dbPath);
    const records = reopened.exportRecords({ taskId: "task_1" }).records;
    const replay = replayAgentRunEventLogRecords(records, {
      now: timestamp,
      runId: "run_1",
      taskId: "task_1",
    });

    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain(plaintext);
    expect(replay.diagnostics).toEqual([]);
    expect(replay.state.eventIds).toEqual(["event-sqlite"]);
    expect(replay.state.plans.plan_1?.envDelta.allowlistedSet.AUTHORIZATION)
      .not.toBe(plaintext);
  });

  it("keeps expired events out of active replay and reports causation gaps", () => {
    const expiredAt = 5_000;
    const freshAt = expiredAt + AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS;
    const expired = event(
      "event-expired",
      null,
      "idem-expired",
      expiredAt,
      buildExecutionPlanFixture({ retention: createAgentRunRetention(expiredAt) }),
    );
    const missingCause = event(
      "event-missing-cause",
      "event-not-present",
      "idem-missing-cause",
      freshAt,
      buildExecutionPlanFixture({ planId: "plan-missing" }),
    );

    const replay = replayAgentRunEvents([expired, missingCause], {
      now: expiredAt + AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS + 1,
    });

    expect(replay.state.expiredEventIds).toEqual(["event-expired"]);
    expect(replay.state.eventIds).toEqual(["event-missing-cause"]);
    expect(replay.state.causationGaps).toEqual(["event-missing-cause"]);
    expect(replay.diagnostics.map((item) => item.code)).toEqual([
      "expired_event",
      "missing_causation",
    ]);
  });

});

function event(
  eventId: string,
  causationId: string | null,
  idempotencyKey: string,
  timestamp: number,
  payload: AgentRunPayload,
): AgentRunEvent {
  const retention = createAgentRunRetention(timestamp);
  const normalizedPayload = payload.schema === "agent.process-handle/v1"
    ? { ...payload, retention, retentionDeadline: retention.expiresAt }
    : { ...payload, retention };
  return buildAgentRunEventFixture({
    eventId,
    causationId,
    idempotencyKey,
    timestamp,
    payload: normalizedPayload,
    retention,
  });
}

function causalRunEvents(): AgentRunEvent[] {
  const artifact = buildArtifactRefFixture();
  return [
    event("event-plan", null, "idem-plan", 3_000, buildExecutionPlanFixture()),
    event("event-process", "event-plan", "idem-process", 3_001, buildProcessHandleFixture()),
    event(
      "event-observation",
      "event-process",
      "idem-observation",
      3_002,
      buildObservationV2Fixture({ artifacts: [artifact] }),
    ),
    event("event-artifact", "event-observation", "idem-artifact", 3_003, artifact),
    event(
      "event-policy",
      "event-artifact",
      "idem-policy",
      3_004,
      buildPolicyDecisionFixture(),
    ),
  ];
}

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "uas-agent-run-event-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

function sqliteStore(dbPath: string): RuntimeTaskEventLogStore {
  return new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
    database: { path: dbPath },
    scope: { taskId: "task_1" },
  }));
}
