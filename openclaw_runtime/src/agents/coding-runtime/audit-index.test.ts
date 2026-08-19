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
import { CodingAuditSqliteIndex } from "./audit-index.js";
import { JsonlCodingAuditStore } from "./audit-log.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-audit-index-"));
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

async function makeStoreWithEvents(): Promise<JsonlCodingAuditStore> {
  const store = new JsonlCodingAuditStore({ filePath: path.join(root, "audit.jsonl") });
  await store.appendLine(`${JSON.stringify(mutationEvent())}\n`);
  await store.appendLine(`${JSON.stringify(execEvent())}\n`);
  await store.appendLine(
    `${JSON.stringify(mutationEvent({ eventId: "evt-m2", sessionId: "s2", timestamp: 1_700_000_000_200, path: "b.txt" }))}\n`,
  );
  return store;
}

describe("CodingAuditSqliteIndex query", () => {
  it("filters by session, time, toolName, path, and redacted command", async () => {
    const store = await makeStoreWithEvents();
    const index = new CodingAuditSqliteIndex({ filePath: path.join(root, "audit.sqlite") });
    index.open();
    for (const event of (await store.readEvents()).events) {
      index.insertEvent(event);
    }

    expect(index.count()).toBe(3);
    expect(index.query("s1", {}).items).toHaveLength(2);
    expect(index.query("s2", {}).items[0]?.path).toBe("b.txt");

    const timePage = index.query("s1", { fromMs: 1_700_000_000_050 });
    expect(timePage.items).toHaveLength(1);
    expect(timePage.items[0]?.eventType).toBe(CODING_RUNTIME_EVENT_TYPES.EXEC);

    expect(index.query("s1", { toolName: "write" }).items).toHaveLength(1);
    expect(index.query("s1", { path: "a.txt" }).items).toHaveLength(1);
    expect(index.query("s1", { command: "pnpm test" }).items).toHaveLength(1);
    expect(index.query("s1", { command: "rm -rf" }).items).toHaveLength(0);
    index.close();
  });

  it("paginates with limit/cursor and never returns more than limit", async () => {
    const store = await makeStoreWithEvents();
    const index = new CodingAuditSqliteIndex({ filePath: path.join(root, "audit.sqlite") });
    index.open();
    for (const event of (await store.readEvents()).events) {
      index.insertEvent(event);
    }

    const first = index.query("s1", { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = index.query("s1", { limit: 1, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.eventId).not.toBe(first.items[0]?.eventId);
    index.close();
  });

  it("rebuilds completely from JSONL events", async () => {
    const store = await makeStoreWithEvents();
    const index = new CodingAuditSqliteIndex({ filePath: path.join(root, "audit.sqlite") });
    index.open();
    const rebuilt = await index.rebuildFromEvents((await store.readEvents()).events);
    expect(rebuilt).toBe(3);
    expect(index.count()).toBe(3);
    expect(index.query("s2", {}).items).toHaveLength(1);
    index.close();
  });
});
