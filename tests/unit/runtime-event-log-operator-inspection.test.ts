import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildCheckpointFixture,
  buildRuntimeTaskEventFixture,
  createRuntimeTaskEventLogRuntimeIntegration,
  inspectRuntimeEventLogForOperator,
  type Checkpoint,
  type RuntimeTaskEvent,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];
const taskId = "operator_event_log_task";
const sessionKey = "agent:main:operator";

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      "scripts/build-openclaw-runtime.mjs",
      "--event-log-operator-inspection-only",
    ],
    {
      cwd: repoRoot(),
      stdio: "pipe",
    },
  );
}, 120_000);

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime event-log readonly operator inspection surface", () => {
  it("stays skipped without opening sqlite when persist is false or omitted", () => {
    let openCalls = 0;
    const openReadOnlyDatabase = () => {
      openCalls += 1;
      throw new Error("disabled operator inspection must not open sqlite");
    };

    expect(inspectRuntimeEventLogForOperator({
      config: { runtime: { eventLog: { persist: false } } },
      databasePath: path.join(createTempDir(), "missing.sqlite"),
      now: () => 10,
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      enabled: false,
      reason: "flag_disabled",
      events: [],
      stats: {
        eventCount: 0,
        returned: 0,
        readStatus: "not_opened",
        corruptRowCount: 0,
        inspectedAt: 10,
      },
      sideEffects: {
        sqliteOpened: false,
        databaseCreated: false,
        tableCreated: false,
        databaseWritten: false,
        migrationRun: false,
        externalArtifactCreated: false,
      },
    });

    expect(inspectRuntimeEventLogForOperator({
      config: {},
      databasePath: path.join(createTempDir(), "missing.sqlite"),
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      events: [],
    });
    expect(openCalls).toBe(0);
  });

  it("requires an explicit database path before opening sqlite", () => {
    let openCalls = 0;

    expect(inspectRuntimeEventLogForOperator({
      config: { runtime: { eventLog: { persist: true } } },
      now: () => 20,
      openReadOnlyDatabase: () => {
        openCalls += 1;
        throw new Error("missing path must not open sqlite");
      },
    })).toMatchObject({
      status: "skipped",
      enabled: false,
      reason: "database_path_required",
      events: [],
      stats: {
        eventCount: 0,
        returned: 0,
        readStatus: "not_opened",
        corruptRowCount: 0,
        inspectedAt: 20,
      },
    });
    expect(openCalls).toBe(0);
  });

  it("does not create a missing database file", () => {
    const dbPath = path.join(createTempDir(), "missing.sqlite");

    expect(inspectRuntimeEventLogForOperator({
      config: { runtime: { eventLog: { persist: true } } },
      databasePath: dbPath,
    })).toMatchObject({
      status: "skipped",
      enabled: false,
      reason: "database_missing",
      events: [],
      sideEffects: {
        sqliteOpened: false,
        databaseCreated: false,
        tableCreated: false,
        databaseWritten: false,
        migrationRun: false,
      },
    });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("does not create event-log tables in an existing unrelated database", () => {
    const dbPath = createTempDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE unrelated_state (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    expect(inspectRuntimeEventLogForOperator({
      config: { runtime: { eventLog: { persist: true } } },
      databasePath: dbPath,
    })).toMatchObject({
      status: "skipped",
      enabled: true,
      reason: "table_missing",
      events: [],
      sideEffects: {
        sqliteOpened: true,
        readOnly: true,
        tableCreated: false,
        databaseWritten: false,
        migrationRun: false,
      },
    });

    const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(tableExists(readonlyDb, "runtime_task_event_log_records")).toBe(false);
      expect(tableExists(readonlyDb, "schema_meta")).toBe(false);
      expect(tableExists(readonlyDb, "unrelated_state")).toBe(true);
    } finally {
      readonlyDb.close();
    }
  });

  it("returns bounded sanitized event summaries and leaves SQLite unchanged", () => {
    const dbPath = createTempDbPath();
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-operator",
      taskId,
      state: "running",
    });
    persistEvents(dbPath, [
      statusEvent("event-created", "created", 1),
      checkpointEvent("event-checkpoint", checkpoint, 2),
      statusEvent("event-running", "running", 3),
      statusEventFor("other-task", "event-other", "running", 4),
    ]);
    markStoredBodyCorrupt(dbPath, "event-running");

    const before = inspectEventTable(dbPath);
    const inspection = inspectRuntimeEventLogForOperator({
      config: { runtime: { eventLog: { persist: true } } },
      databasePath: dbPath,
      taskId,
      limit: 10,
      now: () => 20_000,
      maxAgeMs: 1_000,
      maxRecordsPerTask: 1,
    });
    const after = inspectEventTable(dbPath);

    expect(inspection).toMatchObject({
      status: "loaded",
      enabled: true,
      events: [
        {
          eventId: "event-created",
          taskId,
          kind: "created",
          timestamp: 1,
          sessionKey,
          runId: taskId,
          traceId: `trace-${taskId}`,
        },
        {
          eventId: "event-checkpoint",
          taskId,
          kind: "checkpoint",
          timestamp: 2,
        },
        {
          eventId: "event-running",
          taskId,
          kind: "running",
          timestamp: 3,
        },
      ],
      stats: {
        eventCount: 3,
        returned: 3,
        limit: 10,
        truncated: false,
        readStatus: "partial",
        corruptRowCount: 1,
        taskIds: [taskId],
        eventIds: ["event-created", "event-checkpoint", "event-running"],
        kinds: ["created", "checkpoint", "running"],
        sessionIds: [sessionKey],
        runIds: [taskId],
        traceIds: [`trace-${taskId}`],
        latestCheckpointId: "event-checkpoint",
      },
      retentionEvidence: [
        expect.objectContaining({
          taskId,
          totalRows: 3,
          oldRowCount: 3,
          latestCheckpointId: "event-checkpoint",
        }),
      ],
      resumeComparison: {
        legacyAuthoritative: true,
        eventLogAuthoritative: false,
        comparisonStatus: "not_run",
      },
      diagnostics: [expect.objectContaining({ code: "corrupt_rows_detected" })],
      sideEffects: {
        sqliteOpened: true,
        readOnly: true,
        databaseCreated: false,
        tableCreated: false,
        databaseWritten: false,
        migrationRun: false,
        externalArtifactCreated: false,
      },
    });
    expect(after).toEqual(before);

    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain("apply_patch");
    expect(serialized).not.toContain(["tool", "Output"].join(""));
    expect(serialized).not.toContain(["process", ".env"].join(""));
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain(["trace", "parent"].join(""));
    expect(serialized).not.toContain(["completion", " proof"].join(""));
  });

  it("keeps the explicit local utility bounded and default-off", () => {
    const dbPath = path.join(createTempDir(), "missing.sqlite");
    const result = spawnSync(
      process.execPath,
      [
        "openclaw_runtime/scripts/inspect-runtime-event-log.mjs",
        "--json",
        "--database",
        dbPath,
      ],
      {
        cwd: repoRoot(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(existsSync(dbPath)).toBe(false);
    expect(JSON.parse(String(result.output[1]))).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      sideEffects: {
        sqliteOpened: false,
        databaseCreated: false,
        databaseWritten: false,
        migrationRun: false,
      },
    });
  });
});

function persistEvents(dbPath: string, events: RuntimeTaskEvent[]): void {
  const integration = createRuntimeTaskEventLogRuntimeIntegration({
    config: { runtime: { eventLog: { persist: true } } },
    database: { path: dbPath },
  });
  for (const event of events) {
    integration.append(event, {
      appendedAt: event.timestamp,
      metadata: {
        sessionKey,
        runId: event.taskId,
        traceId: `trace-${event.taskId}`,
      },
    });
  }
  closeOpenClawStateDatabaseForTest();
}

function statusEvent(
  eventId: string,
  kind: "created" | "running" | "completed",
  timestamp: number,
): RuntimeTaskEvent {
  return statusEventFor(taskId, eventId, kind, timestamp);
}

function statusEventFor(
  eventTaskId: string,
  eventId: string,
  kind: "created" | "running" | "completed",
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
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId,
    kind: "checkpoint",
    timestamp,
    payload: { checkpoint },
    traceContext: { traceId: `trace-${taskId}`, spanId: `span-${eventId}` },
  });
}

function markStoredBodyCorrupt(dbPath: string, eventId: string): void {
  const columnName = ["record", "json"].join("_");
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `UPDATE runtime_task_event_log_records SET ${columnName} = ? WHERE event_id = ?`,
    ).run("{not-json", eventId);
  } finally {
    db.close();
  }
}

function inspectEventTable(dbPath: string): {
  total: number;
  taskRows: number;
  metaExists: boolean;
} {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      total: sqlCount(db, "runtime_task_event_log_records"),
      taskRows: sqlCount(db, "runtime_task_event_log_records", `task_id = '${taskId}'`),
      metaExists: tableExists(db, "schema_meta"),
    };
  } finally {
    db.close();
  }
}

function sqlCount(db: DatabaseSync, tableName: string, where?: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}${where ? ` WHERE ${where}` : ""}`)
    .get() as { count?: unknown } | undefined;
  return Number(row?.count ?? 0);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function createTempDbPath(): string {
  return path.join(createTempDir(), "openclaw.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-event-log-operator-"));
  tempDirs.push(dir);
  return dir;
}

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}
