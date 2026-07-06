import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "../../openclaw_runtime/src/config/zod-schema";
import {
  InMemoryRuntimeTaskEventLogStorage,
  RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
  RuntimeTaskEventLogStore,
  buildRuntimeTaskEventFixture,
  createRuntimeTaskEventLogEnvelope,
  resolveRuntimeEventLogFeatureFlags,
  runtimeEventLogFlagEnabled,
  type RuntimeTaskEvent,
  type RuntimeTaskEventLogRecord,
  type RuntimeTaskEventLogStorage,
} from "../../openclaw_runtime/src/runtime-core";

function event(
  eventId: string,
  overrides: Partial<RuntimeTaskEvent> = {},
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId: "task-a",
    kind: "running",
    timestamp: 1,
    evidenceRefs: [],
    ...overrides,
  });
}

class WriteFailingStorage implements RuntimeTaskEventLogStorage {
  load(): unknown[] {
    return [];
  }

  append(): void {
    throw new Error("disk unavailable");
  }
}

class ReadFailingStorage implements RuntimeTaskEventLogStorage {
  load(): unknown[] {
    throw new Error("read unavailable");
  }

  append(): void {
    throw new Error("append should not run after read failure");
  }
}

describe("RuntimeTaskEvent event log store", () => {
  it("appends immutable records without rewriting history", () => {
    const store = new RuntimeTaskEventLogStore();
    const first = event("event-1", {
      timestamp: 10,
      payload: { status: "running", message: "first" },
    });
    const second = event("event-2", {
      timestamp: 11,
      payload: { status: "running", message: "second" },
    });

    const firstResult = store.append(first, { appendedAt: 100 });
    first.payload = { status: "running", message: "mutated after append" };
    const secondResult = store.append(second, { appendedAt: 101 });

    expect(firstResult.appended).toBe(true);
    expect(secondResult.appended).toBe(true);
    expect(store.search().records.map((record) => record.event.eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(
      store.getByEventId("event-1").record?.event.payload,
    ).toEqual({ status: "running", message: "first" });
    expect(store.search().records.map((record) => record.sequence)).toEqual([0, 1]);
  });

  it("deduplicates repeated idempotency keys and preserves the first record", () => {
    const store = new RuntimeTaskEventLogStore();
    const first = store.append(event("event-1"), { idempotencyKey: "tool:1" });
    const duplicate = store.append(event("event-2", { timestamp: 2 }), {
      idempotencyKey: "tool:1",
    });

    expect(first.appended).toBe(true);
    expect(duplicate.appended).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record?.event.eventId).toBe("event-1");
    expect(duplicate.diagnostics).toEqual([
      expect.objectContaining({
        code: "duplicate_idempotency_key",
        idempotencyKey: "tool:1",
        recoverable: true,
      }),
    ]);
    expect(store.search().total).toBe(1);
  });

  it("gets by event id and batch gets missing events as undefined", () => {
    const store = new RuntimeTaskEventLogStore();
    store.appendMany([
      event("event-1"),
      event("event-2", { taskId: "task-b", timestamp: 2 }),
    ]);

    expect(store.getByEventId("event-2").record?.event.taskId).toBe("task-b");
    expect(store.batchGet(["event-2", "missing", "event-1"]).records.map((record) =>
      record?.event.eventId
    )).toEqual(["event-2", undefined, "event-1"]);
  });

  it("filters by task, kind, and timestamp before applying pagination", () => {
    const store = new RuntimeTaskEventLogStore();
    store.appendMany([
      event("event-1", { taskId: "task-a", kind: "running", timestamp: 1 }),
      event("event-2", { taskId: "task-b", kind: "running", timestamp: 2 }),
      event("event-3", { taskId: "task-a", kind: "running", timestamp: 3 }),
      event("event-4", { taskId: "task-a", kind: "completed", timestamp: 4, payload: { status: "completed" } }),
      event("event-5", { taskId: "task-a", kind: "running", timestamp: 5 }),
    ]);

    const firstPage = store.search({
      taskId: "task-a",
      kind: "running",
      timestampGte: 1,
      timestampLt: 6,
      sortOrder: "asc",
      page: 0,
      limit: 2,
    });
    const secondPage = store.search({
      taskId: "task-a",
      kind: "running",
      timestampGte: 1,
      timestampLt: 6,
      sortOrder: "asc",
      page: 1,
      limit: 2,
    });

    expect(firstPage.total).toBe(3);
    expect(firstPage.nextPage).toBe(1);
    expect(firstPage.records.map((record) => record.event.eventId)).toEqual([
      "event-1",
      "event-3",
    ]);
    expect(secondPage.records.map((record) => record.event.eventId)).toEqual(["event-5"]);
  });

  it("exports records in timestamp order with stable append-order ties", () => {
    const store = new RuntimeTaskEventLogStore();
    store.appendMany([
      event("event-20", { timestamp: 20 }),
      event("event-10-a", { timestamp: 10 }),
      event("event-10-b", { timestamp: 10 }),
    ]);

    const exported = store.exportRecords();

    expect([...exported].map((record) => record.event.eventId)).toEqual([
      "event-10-a",
      "event-10-b",
      "event-20",
    ]);
    expect(exported.total).toBe(3);
  });

  it("isolates invalid events as diagnostics and keeps accepting later valid events", () => {
    const store = new RuntimeTaskEventLogStore();
    const invalid = store.append({ eventId: "broken", kind: "unknown" });
    const valid = store.append(event("event-1"));

    expect(invalid.appended).toBe(false);
    expect(invalid.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid_event",
        eventId: "broken",
        recoverable: true,
      }),
    ]);
    expect(valid.appended).toBe(true);
    expect(store.search().records.map((record) => record.event.eventId)).toEqual(["event-1"]);
  });

  it("isolates schema marker mismatches without appending records", () => {
    const store = new RuntimeTaskEventLogStore();
    const mismatchedEnvelope = {
      schemaVersion: 1,
      schemaMarker: "runtime.task-event-log.v0",
      event: event("event-1"),
    };

    const result = store.append(mismatchedEnvelope);

    expect(result.appended).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "schema_marker_mismatch",
        expectedSchemaMarker: RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
        recoverable: true,
      }),
    ]);
    expect(store.search().total).toBe(0);
  });

  it("isolates store write and read failures as diagnostics", () => {
    const writeFailure = new RuntimeTaskEventLogStore(new WriteFailingStorage()).append(
      event("event-1"),
    );
    const readFailure = new RuntimeTaskEventLogStore(new ReadFailingStorage()).search();

    expect(writeFailure.appended).toBe(false);
    expect(writeFailure.diagnostics).toEqual([
      expect.objectContaining({
        code: "store_write_failure",
        eventId: "event-1",
        recoverable: true,
      }),
    ]);
    expect(readFailure.records).toEqual([]);
    expect(readFailure.diagnostics).toEqual([
      expect.objectContaining({
        code: "store_read_failure",
        recoverable: true,
      }),
    ]);
  });

  it("uses indexed append context without loading the whole log", () => {
    let loadCalls = 0;
    const appended: RuntimeTaskEventLogRecord[] = [];
    const storage: RuntimeTaskEventLogStorage = {
      load() {
        loadCalls += 1;
        throw new Error("append must not scan full storage when indexed context exists");
      },
      loadAppendContext(query) {
        expect(query).toEqual({
          taskId: "task-a",
          eventId: "event-indexed",
          idempotencyKey: "idem-indexed",
        });
        return { maxSequence: 4, diagnostics: [] };
      },
      append(record) {
        appended.push(record);
      },
    };

    const result = new RuntimeTaskEventLogStore(storage).append(event("event-indexed"), {
      idempotencyKey: "idem-indexed",
      appendedAt: 123,
    });

    expect(result).toMatchObject({ appended: true, duplicate: false });
    expect(result.record?.sequence).toBe(5);
    expect(appended.map((record) => record.sequence)).toEqual([5]);
    expect(loadCalls).toBe(0);
  });

  it("preserves duplicate behavior through indexed append context", () => {
    const existingEventRecord: RuntimeTaskEventLogRecord = {
      ...createRuntimeTaskEventLogEnvelope(event("event-existing")),
      sequence: 0,
      appendedAt: 100,
    };
    const existingIdempotencyRecord: RuntimeTaskEventLogRecord = {
      ...createRuntimeTaskEventLogEnvelope(event("event-idem")),
      sequence: 1,
      appendedAt: 101,
      idempotencyKey: "idem-existing",
    };
    const storage: RuntimeTaskEventLogStorage = {
      load() {
        throw new Error("append must not scan full storage when indexed context exists");
      },
      loadAppendContext(query) {
        if (query.eventId === "event-existing") {
          return { maxSequence: 1, duplicateEventRecord: existingEventRecord, diagnostics: [] };
        }
        return {
          maxSequence: 1,
          duplicateIdempotencyRecord: existingIdempotencyRecord,
          diagnostics: [],
        };
      },
      append() {
        throw new Error("duplicate append should not write");
      },
    };
    const store = new RuntimeTaskEventLogStore(storage);

    expect(store.append(event("event-existing"))).toMatchObject({
      appended: false,
      duplicate: true,
      record: expect.objectContaining({ event: expect.objectContaining({ eventId: "event-existing" }) }),
      diagnostics: [expect.objectContaining({ code: "duplicate_event_id" })],
    });
    expect(store.append(event("event-new"), { idempotencyKey: "idem-existing" }))
      .toMatchObject({
        appended: false,
        duplicate: true,
        record: expect.objectContaining({ event: expect.objectContaining({ eventId: "event-idem" }) }),
        diagnostics: [expect.objectContaining({ code: "duplicate_idempotency_key" })],
      });
  });

  it("reconciles write-time duplicate event conflicts through indexed reread", () => {
    const existingEventRecord: RuntimeTaskEventLogRecord = {
      ...createRuntimeTaskEventLogEnvelope(event("event-race")),
      sequence: 0,
      appendedAt: 100,
    };
    let readCalls = 0;
    const storage: RuntimeTaskEventLogStorage = {
      load() {
        throw new Error("append conflict reconciliation must not scan full storage");
      },
      loadAppendContext() {
        readCalls += 1;
        return readCalls === 1
          ? { maxSequence: -1, diagnostics: [] }
          : { maxSequence: 0, duplicateEventRecord: existingEventRecord, diagnostics: [] };
      },
      append() {
        throw new Error("SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE constraint failed");
      },
    };

    const result = new RuntimeTaskEventLogStore(storage).append(event("event-race"));

    expect(result).toMatchObject({
      appended: false,
      duplicate: true,
      record: expect.objectContaining({ event: expect.objectContaining({ eventId: "event-race" }) }),
      diagnostics: [expect.objectContaining({ code: "duplicate_event_id" })],
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .not.toContain("store_write_failure");
    expect(readCalls).toBe(2);
  });

  it("reconciles write-time duplicate idempotency conflicts before event id conflicts", () => {
    const existingEventRecord: RuntimeTaskEventLogRecord = {
      ...createRuntimeTaskEventLogEnvelope(event("event-race")),
      sequence: 0,
      appendedAt: 100,
    };
    const existingIdempotencyRecord: RuntimeTaskEventLogRecord = {
      ...createRuntimeTaskEventLogEnvelope(event("event-idem")),
      sequence: 1,
      appendedAt: 101,
      idempotencyKey: "idem-race",
    };
    let readCalls = 0;
    const storage: RuntimeTaskEventLogStorage = {
      load() {
        throw new Error("append conflict reconciliation must not scan full storage");
      },
      loadAppendContext() {
        readCalls += 1;
        return readCalls === 1
          ? { maxSequence: -1, diagnostics: [] }
          : {
              maxSequence: 1,
              duplicateEventRecord: existingEventRecord,
              duplicateIdempotencyRecord: existingIdempotencyRecord,
              diagnostics: [],
            };
      },
      append() {
        throw new Error("SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed");
      },
    };

    const result = new RuntimeTaskEventLogStore(storage).append(event("event-race"), {
      idempotencyKey: "idem-race",
    });

    expect(result).toMatchObject({
      appended: false,
      duplicate: true,
      record: expect.objectContaining({ event: expect.objectContaining({ eventId: "event-idem" }) }),
      diagnostics: [expect.objectContaining({
        code: "duplicate_idempotency_key",
        idempotencyKey: "idem-race",
      })],
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .not.toContain("store_write_failure");
    expect(readCalls).toBe(2);
  });

  it("keeps write failures when indexed reread finds no duplicate", () => {
    let readCalls = 0;
    const storage: RuntimeTaskEventLogStorage = {
      load() {
        throw new Error("append conflict reconciliation must not scan full storage");
      },
      loadAppendContext() {
        readCalls += 1;
        return { maxSequence: -1, diagnostics: [] };
      },
      append() {
        throw new Error("disk still unavailable");
      },
    };

    const result = new RuntimeTaskEventLogStore(storage).append(event("event-write-failure"));

    expect(result).toMatchObject({
      appended: false,
      duplicate: false,
      diagnostics: [expect.objectContaining({ code: "store_write_failure" })],
    });
    expect(readCalls).toBe(2);
  });

  it("keeps write and read diagnostics when post-write reconciliation cannot read", () => {
    let readCalls = 0;
    const storage: RuntimeTaskEventLogStorage = {
      load() {
        throw new Error("append conflict reconciliation must not scan full storage");
      },
      loadAppendContext() {
        readCalls += 1;
        if (readCalls > 1) {
          throw new Error("reread unavailable");
        }
        return { maxSequence: -1, diagnostics: [] };
      },
      append() {
        throw new Error("disk write unavailable");
      },
    };

    const result = new RuntimeTaskEventLogStore(storage).append(event("event-reread-failure"));

    expect(result).toMatchObject({
      appended: false,
      duplicate: false,
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "store_write_failure",
      "store_read_failure",
    ]);
    expect(readCalls).toBe(2);
  });

  it("validates stored records through the envelope contract", () => {
    const storage = new InMemoryRuntimeTaskEventLogStorage([
      {
        ...createRuntimeTaskEventLogEnvelope(event("event-1")),
        sequence: 0,
        appendedAt: 100,
      } satisfies RuntimeTaskEventLogRecord,
    ]);
    const store = new RuntimeTaskEventLogStore(storage);

    expect(store.search().records).toEqual([
      expect.objectContaining({
        schemaMarker: RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
        event: expect.objectContaining({ eventId: "event-1" }),
      }),
    ]);
  });

  it("keeps Phase-4 event-log flags default-off unless explicitly true", () => {
    expect(resolveRuntimeEventLogFeatureFlags({})).toEqual({
      eventLogShadow: false,
      eventLogPersist: false,
      checkpointSerializerShadow: false,
      resumeReplayShadow: false,
    });
    expect(
      resolveRuntimeEventLogFeatureFlags({
        runtime: {
          eventLog: { shadow: true, persist: true },
          checkpointSerializer: { shadow: true },
          resume: { replayShadow: true },
        },
      }),
    ).toEqual({
      eventLogShadow: true,
      eventLogPersist: true,
      checkpointSerializerShadow: true,
      resumeReplayShadow: true,
    });
    expect(runtimeEventLogFlagEnabled({ runtime: { eventLog: { shadow: "true" } } }, "eventLogShadow"))
      .toBe(false);

    const parsed = OpenClawSchema.parse({
      runtime: {
        eventLog: { shadow: true, persist: true },
        checkpointSerializer: { shadow: true },
        resume: { replayShadow: true },
      },
    });
    expect(parsed.runtime?.eventLog?.shadow).toBe(true);
    expect(() =>
      OpenClawSchema.parse({ runtime: { resume: { preferEventLog: true } } }),
    ).toThrow();
  });
});
