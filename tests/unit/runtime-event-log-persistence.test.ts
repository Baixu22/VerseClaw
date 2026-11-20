// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeTaskEventLogStore,
  buildCheckpointFixture,
  buildRuntimeTaskEventFixture,
  buildToolCallRequestFixture,
  createRuntimeTaskEventLogRuntimeIntegration,
  createRuntimeTaskEventLogSqliteStorage,
  pruneRuntimeTaskEventLogRecords,
  type Checkpoint,
  type RuntimeTaskEvent,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildRuntimeResumeCheckpoint,
  type LongTaskCheckpointRecord,
} from "../../openclaw_runtime/src/agents/long-task-control/store";
import {
  runPersistedRuntimeResumeShadow,
} from "../../openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../../openclaw_runtime/src/infra/kysely-sync";
import type { DB as OpenClawStateDatabaseShape } from "../../openclaw_runtime/src/state/openclaw-state-db.generated";

type RuntimeTaskEventLogTestDatabase = Pick<
  OpenClawStateDatabaseShape,
  "runtime_task_event_log_records"
>;

const tempDirs: string[] = [];
const taskId = "loop_event_log_persisted";
const sessionKey = "agent:main:persisted";

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime event-log SQLite persistence", () => {
  it("does not open SQLite when event-log persist is disabled", () => {
    let openCalls = 0;
    const integration = createRuntimeTaskEventLogRuntimeIntegration({
      config: { runtime: { eventLog: { persist: false } } },
      openDatabase: () => {
        openCalls += 1;
        throw new Error("disabled event-log persistence must not open sqlite");
      },
    });

    expect(integration.append(statusEvent("event-disabled", "created", 1))).toEqual({
      appended: false,
      duplicate: false,
      diagnostics: [],
    });
    expect(openCalls).toBe(0);
  });

  it("persists task-scoped records and reloads them through the event-log store", () => {
    const dbPath = createTempDbPath();
    const integration = createRuntimeTaskEventLogRuntimeIntegration({
      config: { runtime: { eventLog: { persist: true } } },
      database: { path: dbPath },
    });

    expect(integration.append(statusEvent("event-created", "created", 10), {
      metadata: {
        sessionKey,
        workspaceId: "workspace-a",
        runId: taskId,
        taskLedgerRootId: "tlroot-persisted",
        traceId: "trace-persisted",
      },
    })).toMatchObject({ appended: true, duplicate: false });
    expect(integration.append(statusEvent("event-running", "running", 20), {
      metadata: { sessionKey, runId: taskId },
    })).toMatchObject({ appended: true, duplicate: false });

    const reloaded = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { taskId },
    }));
    const searched = reloaded.search({ taskId });
    const exported = reloaded.exportRecords({ taskId });
    expect(searched.records.map((record) => record.event.eventId)).toEqual([
      "event-created",
      "event-running",
    ]);
    expect(exported.records.map((record) => record.event.eventId)).toEqual([
      "event-created",
      "event-running",
    ]);
    expect(searched.records.map((record) => record.sequence)).toEqual([0, 1]);
    expect(searched.records[0]?.metadata).toMatchObject({
      sessionKey,
      workspaceId: "workspace-a",
      runId: taskId,
      taskLedgerRootId: "tlroot-persisted",
      traceId: "trace-persisted",
    });
  });

  it("reloads records after reopening SQLite and supports session/trace scoped reads", () => {
    const dbPath = createTempDbPath();
    const integration = createRuntimeTaskEventLogRuntimeIntegration({
      config: { runtime: { eventLog: { persist: true } } },
      database: { path: dbPath },
    });

    expect(integration.append(statusEventFor("task-a", "event-a", "created", 1), {
      metadata: { sessionKey: "session-a", runId: "task-a", traceId: "trace-a" },
    })).toMatchObject({ appended: true });
    expect(integration.append(statusEventFor("task-b", "event-b", "running", 2), {
      metadata: { sessionKey: "session-a", runId: "task-b", traceId: "trace-b" },
    })).toMatchObject({ appended: true });
    expect(integration.append(statusEventFor("task-c", "event-c", "completed", 3), {
      metadata: { sessionKey: "session-c", runId: "task-c", traceId: "trace-a" },
    })).toMatchObject({ appended: true });

    closeOpenClawStateDatabaseForTest();

    const sessionRecords = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { sessionKey: "session-a" },
    })).exportRecords().records;
    const traceRecords = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { traceId: "trace-a" },
    })).exportRecords().records;

    expect(sessionRecords.map((record) => record.event.eventId)).toEqual(["event-a", "event-b"]);
    expect(traceRecords.map((record) => record.event.eventId)).toEqual(["event-a", "event-c"]);
    expect(sessionRecords.map((record) => record.sequence)).toEqual([0, 0]);
  });

  it("keeps duplicate idempotency scoped to one task", () => {
    const dbPath = createTempDbPath();
    const firstTaskStore = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { taskId: "task-a" },
    }));
    const secondTaskStore = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { taskId: "task-b" },
    }));

    expect(firstTaskStore.append(toolRequestEvent("task-a", "event-a-1", "idem-shared")))
      .toMatchObject({ appended: true, duplicate: false });
    expect(firstTaskStore.append(toolRequestEvent("task-a", "event-a-2", "idem-shared")))
      .toMatchObject({
        appended: false,
        duplicate: true,
        diagnostics: [expect.objectContaining({ code: "duplicate_idempotency_key" })],
      });
    expect(secondTaskStore.append(toolRequestEvent("task-b", "event-b-1", "idem-shared")))
      .toMatchObject({ appended: true, duplicate: false });
  });

  it("reports SQLite read failures as store diagnostics instead of throwing", () => {
    const integration = createRuntimeTaskEventLogRuntimeIntegration({
      config: { runtime: { eventLog: { persist: true } } },
      openDatabase: () => {
        throw new Error("sqlite unavailable");
      },
    });

    expect(integration.append(statusEvent("event-failure", "created", 1))).toMatchObject({
      appended: false,
      duplicate: false,
      diagnostics: [expect.objectContaining({ code: "store_read_failure" })],
    });
  });

  it("diagnoses corrupt persisted record JSON without throwing to callers", () => {
    const dbPath = createTempDbPath();
    persistEvents(dbPath, [statusEvent("event-valid", "running", 1)]);
    insertCorruptEventLogRecord(dbPath, {
      eventId: "event-corrupt",
      taskId,
      taskSequence: 9,
      timestamp: 9,
    });

    const result = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { taskId },
    })).search({ taskId });
    const exported = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
      database: { path: dbPath },
      scope: { taskId },
    })).exportRecords({ taskId });

    expect(result.records.map((record) => record.event.eventId)).toEqual(["event-valid"]);
    expect(exported.records.map((record) => record.event.eventId)).toEqual(["event-valid"]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "store_read_failure",
        eventId: "event-corrupt",
        recoverable: true,
      }),
    ]);
  });

  it("prunes only old rows outside the recent task window and before the latest checkpoint", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-anchor",
      taskId,
      state: "running",
    });
    persistEventsWithAppendedAt(dbPath, [
      { event: statusEvent("event-old-0", "running", 1), appendedAt: 1_000 },
      { event: statusEvent("event-old-1", "running", 2), appendedAt: 1_000 },
      { event: statusEvent("event-old-2", "running", 3), appendedAt: 1_000 },
      { event: checkpointEvent("event-checkpoint-anchor", checkpoint, 4), appendedAt: 1_000 },
      { event: statusEvent("event-after-4", "running", 5), appendedAt: 9_500 },
      { event: statusEvent("event-after-5", "running", 6), appendedAt: 9_500 },
      { event: statusEvent("event-after-6", "completed", 7), appendedAt: 9_500 },
    ]);

    const dryRun = pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      taskId,
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 3,
      deleteBatchSize: 100,
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      dryRun: true,
      scannedTasks: 1,
      taskIds: [taskId],
      eligibleTasks: 1,
      skippedTasks: 0,
      pruned: 3,
      diagnostics: [],
      taskResults: [expect.objectContaining({
        taskId,
        totalRows: 7,
        oldRowCount: 4,
        candidateCount: 3,
        pruned: 3,
        latestCheckpointSequence: 3,
      })],
    });
    expect(listPersistedEventIds(dbPath, taskId)).toEqual([
      "event-old-0",
      "event-old-1",
      "event-old-2",
      "event-checkpoint-anchor",
      "event-after-4",
      "event-after-5",
      "event-after-6",
    ]);

    const pruned = pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      taskId,
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 3,
      deleteBatchSize: 100,
    });

    expect(pruned).toMatchObject({
      dryRun: false,
      scannedTasks: 1,
      taskIds: [taskId],
      eligibleTasks: 1,
      skippedTasks: 0,
      pruned: 3,
      diagnostics: [],
      taskResults: [expect.objectContaining({
        taskId,
        candidateCount: 3,
        pruned: 3,
      })],
    });
    expect(listPersistedEventIds(dbPath, taskId)).toEqual([
      "event-checkpoint-anchor",
      "event-after-4",
      "event-after-5",
      "event-after-6",
    ]);
  });

  it("selects global prune tasks by oldest eligible rows instead of task id order", () => {
    const dbPath = createTempDbPath();
    persistEventsWithAppendedAt(dbPath, [
      { event: statusEventFor("aaa-small", "aaa-old-0", "running", 1), appendedAt: 1_000 },
      { event: statusEventFor("aaa-small", "aaa-old-1", "running", 2), appendedAt: 1_000 },
      { event: statusEventFor("mmm-eligible", "mmm-old-0", "running", 1), appendedAt: 2_000 },
      { event: statusEventFor("mmm-eligible", "mmm-old-1", "running", 2), appendedAt: 2_000 },
      { event: statusEventFor("mmm-eligible", "mmm-old-2", "running", 3), appendedAt: 2_000 },
      { event: statusEventFor("mmm-eligible", "mmm-new-3", "running", 4), appendedAt: 9_500 },
      { event: statusEventFor("mmm-eligible", "mmm-new-4", "completed", 5), appendedAt: 9_500 },
      { event: statusEventFor("zzz-eligible", "zzz-old-0", "running", 1), appendedAt: 1_000 },
      { event: statusEventFor("zzz-eligible", "zzz-old-1", "running", 2), appendedAt: 1_000 },
      { event: statusEventFor("zzz-eligible", "zzz-old-2", "running", 3), appendedAt: 1_000 },
      { event: statusEventFor("zzz-eligible", "zzz-new-3", "running", 4), appendedAt: 9_500 },
      { event: statusEventFor("zzz-eligible", "zzz-new-4", "completed", 5), appendedAt: 9_500 },
    ]);

    const pruned = pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 2,
      deleteBatchSize: 100,
      maxTasksPerRun: 1,
    });

    expect(pruned).toMatchObject({
      scannedTasks: 1,
      taskIds: ["zzz-eligible"],
      eligibleTasks: 1,
      skippedTasks: 0,
      pruned: 3,
      taskResults: [expect.objectContaining({
        taskId: "zzz-eligible",
        totalRows: 5,
        oldRowCount: 3,
        candidateCount: 3,
      })],
    });
    expect(listPersistedEventIds(dbPath, "aaa-small")).toEqual(["aaa-old-0", "aaa-old-1"]);
    expect(listPersistedEventIds(dbPath, "zzz-eligible")).toEqual([
      "zzz-new-3",
      "zzz-new-4",
    ]);
  });

  it("does not let checkpoint-protected global prune tasks starve later prunable tasks", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "protected-checkpoint",
      taskId: "aaa-protected",
      state: "running",
    });
    persistEventsWithAppendedAt(dbPath, [
      { event: checkpointEventFor("aaa-protected", "protected-checkpoint", checkpoint, 1), appendedAt: 500 },
      { event: statusEventFor("aaa-protected", "protected-old-1", "running", 2), appendedAt: 500 },
      { event: statusEventFor("aaa-protected", "protected-old-2", "running", 3), appendedAt: 500 },
      { event: statusEventFor("aaa-protected", "protected-new-3", "completed", 4), appendedAt: 9_500 },
      { event: statusEventFor("zzz-prunable", "prunable-old-0", "running", 1), appendedAt: 1_000 },
      { event: statusEventFor("zzz-prunable", "prunable-old-1", "running", 2), appendedAt: 1_000 },
      { event: statusEventFor("zzz-prunable", "prunable-old-2", "running", 3), appendedAt: 1_000 },
      { event: statusEventFor("zzz-prunable", "prunable-new-3", "completed", 4), appendedAt: 9_500 },
    ]);

    const pruned = pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 1,
      deleteBatchSize: 100,
      maxTasksPerRun: 1,
    });

    expect(pruned).toMatchObject({
      scannedTasks: 1,
      taskIds: ["zzz-prunable"],
      eligibleTasks: 1,
      skippedTasks: 0,
      pruned: 3,
      taskResults: [expect.objectContaining({
        taskId: "zzz-prunable",
        totalRows: 4,
        oldRowCount: 3,
        candidateCount: 3,
      })],
    });
    expect(listPersistedEventIds(dbPath, "aaa-protected")).toEqual([
      "protected-checkpoint",
      "protected-old-1",
      "protected-old-2",
      "protected-new-3",
    ]);
    expect(listPersistedEventIds(dbPath, "zzz-prunable")).toEqual(["prunable-new-3"]);
  });

  it("reports retention skip reasons for task-scoped prune attempts", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "protected-checkpoint",
      taskId: "task-protected",
      state: "running",
    });
    persistEventsWithAppendedAt(dbPath, [
      { event: statusEventFor("task-small", "small-old-0", "running", 1), appendedAt: 1_000 },
      { event: statusEventFor("task-small", "small-old-1", "running", 2), appendedAt: 1_000 },
      { event: statusEventFor("task-fresh", "fresh-0", "running", 1), appendedAt: 9_500 },
      { event: statusEventFor("task-fresh", "fresh-1", "running", 2), appendedAt: 9_500 },
      { event: statusEventFor("task-fresh", "fresh-2", "running", 3), appendedAt: 9_500 },
      { event: statusEventFor("task-fresh", "fresh-3", "completed", 4), appendedAt: 9_500 },
      { event: checkpointEventFor("task-protected", "protected-checkpoint", checkpoint, 1), appendedAt: 1_000 },
      { event: statusEventFor("task-protected", "protected-old-1", "running", 2), appendedAt: 1_000 },
      { event: statusEventFor("task-protected", "protected-old-2", "running", 3), appendedAt: 1_000 },
      { event: statusEventFor("task-protected", "protected-new-3", "completed", 4), appendedAt: 9_500 },
    ]);

    expect(pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      taskId: "task-small",
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 3,
    }).taskResults).toEqual([
      expect.objectContaining({ taskId: "task-small", skippedReason: "below_record_floor" }),
    ]);
    expect(pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      taskId: "task-fresh",
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 2,
    }).taskResults).toEqual([
      expect.objectContaining({ taskId: "task-fresh", skippedReason: "no_old_candidates" }),
    ]);
    expect(pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      taskId: "task-protected",
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 1,
    }).taskResults).toEqual([
      expect.objectContaining({
        taskId: "task-protected",
        skippedReason: "checkpoint_anchor_protected",
        latestCheckpointSequence: 0,
      }),
    ]);
  });

  it("prunes corrupt persisted rows by metadata without parsing record JSON", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-after-corrupt",
      taskId,
      state: "running",
    });
    insertCorruptEventLogRecord(dbPath, {
      eventId: "event-corrupt-prune",
      taskId,
      taskSequence: 0,
      timestamp: 1,
    });
    persistEventsWithAppendedAt(dbPath, [
      { event: checkpointEvent("event-checkpoint-after-corrupt", checkpoint, 2), appendedAt: 1_000 },
      { event: statusEvent("event-after-corrupt-1", "running", 3), appendedAt: 9_500 },
      { event: statusEvent("event-after-corrupt-2", "completed", 4), appendedAt: 9_500 },
    ]);

    const pruned = pruneRuntimeTaskEventLogRecords({
      database: { path: dbPath },
      taskId,
      now: 10_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 1,
      deleteBatchSize: 100,
    });

    expect(pruned).toMatchObject({
      diagnostics: [],
      pruned: 1,
      taskResults: [expect.objectContaining({
        candidateCount: 1,
        pruned: 1,
      })],
    });
    expect(listPersistedEventIds(dbPath, taskId)).toEqual([
      "event-checkpoint-after-corrupt",
      "event-after-corrupt-1",
      "event-after-corrupt-2",
    ]);
  });
});

describe("persisted runtime resume shadow report", () => {
  it("is disabled without reading SQLite or legacy checkpoints when replay shadow is off", () => {
    let openCalls = 0;
    const latestCheckpointReader = vi.fn(() => {
      throw new Error("disabled report must not read legacy checkpoint");
    });

    const report = runPersistedRuntimeResumeShadow({
      config: {},
      taskId,
      sessionKey,
      openDatabase: () => {
        openCalls += 1;
        throw new Error("disabled report must not open sqlite");
      },
      latestCheckpointReader,
    });

    expect(report.enabled).toBe(false);
    expect(report.eventCount).toBe(0);
    expect(report.summary).toEqual({
      matchStatus: "disabled",
      legacyAuthoritative: true,
      eventCount: 0,
      eventLogReadStatus: "clean",
      replayableEventCount: 0,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 0,
      mismatchFields: [],
      blockingDiagnosticCodes: [],
      recommendation: "use_legacy_checkpoint",
    });
    expect(report.resumeShadowResult.legacyAuthoritative).toBe(true);
    expect(openCalls).toBe(0);
    expect(latestCheckpointReader).not.toHaveBeenCalled();
  });

  it("compares persisted event-log replay against the latest legacy checkpoint", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "ltcp-persisted",
      taskId,
      state: "completed",
      openObligations: [],
      toolResults: [],
      fileHashes: {},
    });
    persistEvents(dbPath, [
      statusEvent("event-created", "created", 1),
      checkpointEvent("event-checkpoint", checkpoint, 2),
      statusEvent("event-completed", "completed", 3),
    ]);

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => legacyCheckpointRecord("completed"),
    });

    expect(report.enabled).toBe(true);
    expect(report.eventCount).toBe(3);
    expect(report.latestCheckpointId).toBe("ltcp-persisted");
    expect(report.summary).toMatchObject({
      matchStatus: "matched",
      legacyAuthoritative: true,
      eventCount: 3,
      eventLogReadStatus: "clean",
      replayableEventCount: 3,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 0,
      latestEventKind: "completed",
      latestEventTimestamp: 3,
      latestCheckpointId: "ltcp-persisted",
      mismatchFields: [],
      blockingDiagnosticCodes: [],
      recommendation: "use_legacy_checkpoint",
    });
    expect(report.resumeShadowResult.legacyAuthoritative).toBe(true);
    expect(report.resumeShadowResult.comparison).toMatchObject({
      matches: true,
      mismatchedFields: [],
    });
  });

  it("diagnoses a missing legacy checkpoint without changing authority", () => {
    const dbPath = createTempDbPath();
    persistEvents(dbPath, [statusEvent("event-running", "running", 1)]);

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => undefined,
    });

    expect(report.eventCount).toBe(1);
    expect(report.latestCheckpointId).toBeUndefined();
    expect(report.legacyAuthoritative).toBe(true);
    expect(report.summary).toMatchObject({
      matchStatus: "legacy_missing",
      eventCount: 1,
      eventLogReadStatus: "clean",
      replayableEventCount: 1,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 0,
      blockingDiagnosticCodes: ["legacy_state_missing"],
      recommendation: "inspect_event_log",
    });
    expect(report.resumeShadowResult.legacyAuthoritative).toBe(true);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      source: "resume_shadow",
      code: "legacy_state_missing",
      taskId,
    }));
  });

  it("keeps legacy authoritative when persisted replay waits on a mutating tool result", () => {
    const dbPath = createTempDbPath();
    persistEvents(dbPath, [
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      statusEvent("event-waiting-tool", "waiting_tool", 3),
      toolRequestEvent(taskId, "event-tool-request", "idem-missing-result"),
    ]);

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => legacyCheckpointRecord("completed"),
    });

    expect(report.resumeShadowResult.status).toBe("waiting_verification");
    expect(report.summary).toMatchObject({
      matchStatus: "waiting_verification",
      eventLogReadStatus: "clean",
      replayableEventCount: 4,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 0,
      blockingDiagnosticCodes: expect.arrayContaining(["missing_mutating_tool_result"]),
      recommendation: "wait_for_tool_verification",
    });
    expect(report.resumeShadowResult.legacyAuthoritative).toBe(true);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      source: "resume_shadow",
      code: "missing_mutating_tool_result",
      idempotencyKey: "idem-missing-result",
    }));
  });

  it("reports ambiguous mutating tool requests as waiting verification only", () => {
    const dbPath = createTempDbPath();
    persistEvents(dbPath, [
      statusEvent("event-running", "running", 1),
      toolRequestEvent(taskId, "event-tool-ambiguous"),
    ]);

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => legacyCheckpointRecord("completed"),
    });

    expect(report.resumeShadowResult.status).toBe("waiting_verification");
    expect(report.summary).toMatchObject({
      matchStatus: "waiting_verification",
      eventLogReadStatus: "clean",
      replayableEventCount: 2,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 0,
      blockingDiagnosticCodes: expect.arrayContaining(["ambiguous_mutating_tool_result"]),
      recommendation: "wait_for_tool_verification",
    });
    expect(report.resumeShadowResult.toolReuses).toContainEqual(expect.objectContaining({
      status: "ambiguous",
      toolName: "apply_patch",
    }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      source: "resume_shadow",
      code: "ambiguous_mutating_tool_result",
    }));
  });

  it("summarizes persisted replay mismatches without changing legacy authority", () => {
    const dbPath = createTempDbPath();
    persistEvents(dbPath, [
      statusEvent("event-created", "created", 1),
      statusEvent("event-completed", "completed", 2),
    ]);

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => legacyCheckpointRecord("failed"),
    });

    expect(report.legacyAuthoritative).toBe(true);
    expect(report.resumeShadowResult.comparison).toMatchObject({
      matches: false,
      mismatchedFields: expect.arrayContaining(["status"]),
    });
    expect(report.summary).toMatchObject({
      matchStatus: "mismatch",
      eventLogReadStatus: "clean",
      replayableEventCount: 2,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 0,
      mismatchFields: expect.arrayContaining(["status"]),
      blockingDiagnosticCodes: ["state_mismatch"],
      recommendation: "inspect_event_log",
    });
  });

  it("summarizes corrupt persisted rows as partial while keeping healthy replay status", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "ltcp-persisted",
      taskId,
      state: "completed",
      openObligations: [],
      toolResults: [],
      fileHashes: {},
    });
    persistEvents(dbPath, [
      statusEvent("event-created", "created", 1),
      checkpointEvent("event-checkpoint", checkpoint, 2),
      statusEvent("event-completed", "completed", 3),
    ]);
    insertCorruptEventLogRecord(dbPath, {
      eventId: "event-corrupt-report",
      taskId,
      taskSequence: 9,
      timestamp: 9,
    });

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => legacyCheckpointRecord("completed"),
    });

    expect(report.eventCount).toBe(3);
    expect(report.summary).toMatchObject({
      matchStatus: "matched",
      eventLogReadStatus: "partial",
      eventCount: 3,
      replayableEventCount: 3,
      corruptRowCount: 1,
      eventLogStoreFailureCount: 1,
      blockingDiagnosticCodes: ["store_read_failure"],
      recommendation: "inspect_event_log",
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      source: "event_log_store",
      code: "store_read_failure",
      eventId: "event-corrupt-report",
    }));
  });

  it("summarizes corrupt-only persisted rows as event-log unreadable", () => {
    const dbPath = createTempDbPath();
    insertCorruptEventLogRecord(dbPath, {
      eventId: "event-corrupt-only",
      taskId,
      taskSequence: 0,
      timestamp: 1,
    });

    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      database: { path: dbPath },
      latestCheckpointReader: () => legacyCheckpointRecord("completed"),
    });

    expect(report.eventCount).toBe(0);
    expect(report.summary).toMatchObject({
      matchStatus: "event_log_unreadable",
      eventLogReadStatus: "unreadable",
      replayableEventCount: 0,
      corruptRowCount: 1,
      eventLogStoreFailureCount: 1,
      recommendation: "inspect_event_log",
    });
  });

  it("summarizes store-level event-log read failures as unreadable", () => {
    const report = runPersistedRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      sessionKey,
      openDatabase: () => {
        throw new Error("sqlite unavailable");
      },
      latestCheckpointReader: () => legacyCheckpointRecord("completed"),
    });

    expect(report.eventCount).toBe(0);
    expect(report.summary).toMatchObject({
      matchStatus: "event_log_unreadable",
      eventLogReadStatus: "unreadable",
      replayableEventCount: 0,
      corruptRowCount: 0,
      eventLogStoreFailureCount: 1,
      recommendation: "inspect_event_log",
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      source: "event_log_store",
      code: "store_read_failure",
    }));
  });
});

function persistEvents(dbPath: string, events: RuntimeTaskEvent[]): void {
  const integration = createRuntimeTaskEventLogRuntimeIntegration({
    config: { runtime: { eventLog: { persist: true } } },
    database: { path: dbPath },
  });
  for (const event of events) {
    integration.append(event, { metadata: { sessionKey, runId: taskId } });
  }
}

function persistEventsWithAppendedAt(
  dbPath: string,
  entries: Array<{ event: RuntimeTaskEvent; appendedAt: number }>,
): void {
  const store = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
    database: { path: dbPath },
    scope: { taskId },
  }));
  for (const entry of entries) {
    store.append(entry.event, {
      appendedAt: entry.appendedAt,
      metadata: { sessionKey, runId: entry.event.taskId },
    });
  }
}

function listPersistedEventIds(dbPath: string, rowTaskId: string): string[] {
  const stateDb = openOpenClawStateDatabase({ path: dbPath });
  const db = getNodeSqliteKysely<RuntimeTaskEventLogTestDatabase>(stateDb.db);
  return executeSqliteQuerySync(
    stateDb.db,
    db
      .selectFrom("runtime_task_event_log_records")
      .select("event_id")
      .where("task_id", "=", rowTaskId)
      .orderBy("task_sequence", "asc"),
  ).rows.map((row) => row.event_id);
}

function statusEvent(
  eventId: string,
  kind: "created" | "running" | "waiting_tool" | "completed",
  timestamp: number,
): RuntimeTaskEvent {
  return statusEventFor(taskId, eventId, kind, timestamp);
}

function statusEventFor(
  eventTaskId: string,
  eventId: string,
  kind: "created" | "running" | "waiting_tool" | "completed",
  timestamp: number,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId: eventTaskId,
    kind,
    timestamp,
    traceContext: { traceId: `trace-${eventTaskId}`, spanId: `span-${eventId}` },
  });
}

function checkpointEvent(
  eventId: string,
  checkpoint: Checkpoint,
  timestamp: number,
): RuntimeTaskEvent {
  return checkpointEventFor(taskId, eventId, checkpoint, timestamp);
}

function checkpointEventFor(
  eventTaskId: string,
  eventId: string,
  checkpoint: Checkpoint,
  timestamp: number,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId: eventTaskId,
    kind: "checkpoint",
    timestamp,
    payload: { checkpoint },
  });
}

function toolRequestEvent(
  requestTaskId: string,
  eventId: string,
  idempotencyKey?: string,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId: requestTaskId,
    kind: "tool_call_request",
    timestamp: 4,
    payload: buildToolCallRequestFixture({
      taskId: requestTaskId,
      toolName: "apply_patch",
      idempotencyKey,
      permissionContext: { effect: "write" },
    }),
  });
}

function legacyCheckpointRecord(status: "completed" | "failed"): LongTaskCheckpointRecord {
  const checkpoint = buildRuntimeResumeCheckpoint({
    id: "ltcp-persisted",
    sessionKey,
    trigger: "guide",
    createdAt: 10,
  });
  return {
    id: "ltcp-persisted",
    sessionKey,
    runId: taskId,
    trigger: "guide",
    status,
    checkpoint,
    createdAt: 10,
    updatedAt: 10,
  };
}

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-event-log-persistence-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

function insertCorruptEventLogRecord(
  dbPath: string,
  input: {
    eventId: string;
    taskId: string;
    taskSequence: number;
    timestamp: number;
  },
): void {
  const stateDb = openOpenClawStateDatabase({ path: dbPath });
  const db = getNodeSqliteKysely<RuntimeTaskEventLogTestDatabase>(stateDb.db);
  executeSqliteQuerySync(
    stateDb.db,
    db.insertInto("runtime_task_event_log_records").values({
      event_id: input.eventId,
      task_id: input.taskId,
      task_sequence: input.taskSequence,
      kind: "running",
      event_timestamp: input.timestamp,
      appended_at: input.timestamp,
      idempotency_key: null,
      session_key: sessionKey,
      workspace_id: null,
      run_id: input.taskId,
      task_ledger_root_id: null,
      trace_id: "trace-corrupt",
      schema_version: 1,
      schema_marker: "runtime.task-event-log.v1",
      record_json: "{not-json",
    }),
  );
}
