import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCodingAuditEvent } from "../../../../shared/coding-runtime/schema.js";
import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  type CodingExecEvent,
  type CodingMutationEvent,
} from "../../../../shared/coding-runtime/types.js";
import { JsonlCodingAuditStore, PersistentCodingAuditSink } from "./audit-log.js";
import { replay, replayCodingSession } from "./replay.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-replay-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function mutationEvent(overrides: Partial<CodingMutationEvent> = {}): CodingMutationEvent {
  const event: CodingMutationEvent = {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: "evt-m1",
    eventType: CODING_RUNTIME_EVENT_TYPES.MUTATION,
    sessionId: "s1",
    requestId: "r1",
    toolName: "write",
    timestamp: 1_700_000_000_000,
    path: "a.txt",
    beforeHash: null,
    afterHash: "a".repeat(64),
    workspaceRoot: "/work",
    phase: "committed",
    mutationId: "m1",
    batchId: "b1",
    kind: "write",
    mutation: { kind: "write", path: "a.txt", content: "hello" },
    hadPrior: false,
    bytesBefore: 0,
    bytesAfter: 5,
    beforeVersion: null,
    afterVersion: { path: "a.txt", contentHash: "a".repeat(64), mtimeMs: 1_700_000_000_000, size: 5 },
    ...overrides,
  };
  assertCodingAuditEvent(event);
  return event;
}

function execEvent(overrides: Partial<CodingExecEvent> = {}): CodingExecEvent {
  const event: CodingExecEvent = {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: "evt-e1",
    eventType: CODING_RUNTIME_EVENT_TYPES.EXEC,
    sessionId: "s1",
    requestId: "r2",
    toolName: "exec",
    timestamp: 1_700_000_000_100,
    path: "/work",
    beforeHash: "b".repeat(64),
    afterHash: "c".repeat(64),
    workspaceRoot: "/work",
    commandId: "cmd-1",
    commandHash: "d".repeat(64),
    commandRedacted: "pnpm test -- --run",
    cwd: "/work",
    status: "succeeded",
    exitCode: 0,
    durationMs: 10,
    outputTruncated: false,
    sideEffects: [],
    ...overrides,
  };
  assertCodingAuditEvent(event);
  return event;
}

describe("replayCodingSession", () => {
  it("returns events in JSONL append order and filters by session", async () => {
    const store = new JsonlCodingAuditStore({ filePath: path.join(root, "audit.jsonl") });
    const first = mutationEvent({ eventId: "evt-first", sessionId: "s1" });
    const otherSession = mutationEvent({ eventId: "evt-other", sessionId: "s2" });
    const third = execEvent({ eventId: "evt-third", sessionId: "s1" });
    await store.appendLine(`${JSON.stringify(first)}\n`);
    await store.appendLine(`${JSON.stringify(otherSession)}\n`);
    await store.appendLine(`${JSON.stringify(third)}\n`);

    const result = await replayCodingSession("s1", store);
    expect(result.events.map((event) => event.eventId)).toEqual(["evt-first", "evt-third"]);
    expect(result.warnings).toEqual([]);
    expect(await replay("s2", store)).toHaveLength(1);
  });

  it("preserves real concurrent mutation + exec order as written to the durable sink", async () => {
    const sink = new PersistentCodingAuditSink({
      jsonlPath: path.join(root, "audit", "audit.jsonl"),
      sqlitePath: path.join(root, "audit", "audit.sqlite"),
    });
    const mutation = mutationEvent({ eventId: "evt-mutation-concurrent", sessionId: "s-concurrent" });
    const exec = execEvent({ eventId: "evt-exec-concurrent", sessionId: "s-concurrent" });
    const order: string[] = [];

    await Promise.all([
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("mutation");
        sink.write(mutation);
      })(),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("exec");
        sink.write(exec);
      })(),
    ]);
    await sink.flush();

    const store = new JsonlCodingAuditStore({ filePath: sink.jsonlPath });
    const replayed = await replay("s-concurrent", store);
    expect(order).toEqual(["exec", "mutation"]);
    expect(replayed.map((event) => event.eventId)).toEqual([
      "evt-exec-concurrent",
      "evt-mutation-concurrent",
    ]);
    await sink.close();
  });
});
