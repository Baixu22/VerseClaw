import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCodingAuditEvent, isCodingAuditEvent } from "../../../../shared/coding-runtime/schema.js";
import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  type CodingAuditEvent,
  type CodingExecEvent,
  type CodingMutationEvent,
} from "../../../../shared/coding-runtime/types.js";
import { __resetWriteJournals } from "../tools/write-journal.js";
import {
  JsonlCodingAuditStore,
  PersistentCodingAuditSink,
  resolveCodingAuditLogDir,
} from "./audit-log.js";
import { FileTransactionService } from "./file-transaction-service.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-audit-log-"));
  __resetWriteJournals();
});

afterEach(async () => {
  __resetWriteJournals();
  await fs.rm(root, { recursive: true, force: true });
});

function baseEvent(overrides: Partial<CodingAuditEvent> = {}) {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: "evt-1",
    eventType: CODING_RUNTIME_EVENT_TYPES.MUTATION,
    sessionId: "s1",
    requestId: "r1",
    toolName: "write",
    timestamp: 1_700_000_000_000,
    path: "a.txt",
    beforeHash: null,
    afterHash: "a".repeat(64),
    workspaceRoot: "/work",
    ...overrides,
  };
}

function mutationEvent(overrides: Partial<CodingMutationEvent> = {}): CodingMutationEvent {
  const event: CodingMutationEvent = {
    ...baseEvent(),
    eventId: "evt-mutation-1",
    eventType: CODING_RUNTIME_EVENT_TYPES.MUTATION,
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
    ...baseEvent(),
    eventId: "evt-exec-1",
    eventType: CODING_RUNTIME_EVENT_TYPES.EXEC,
    toolName: "exec",
    path: "/work",
    beforeHash: "b".repeat(64),
    afterHash: "c".repeat(64),
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

describe("resolveCodingAuditLogDir", () => {
  it("places the log dir under the existing OpenClaw state dir, not the workspace", () => {
    const stateDir = path.join(root, "state");
    expect(
      resolveCodingAuditLogDir({
        env: { ...process.env, OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
      }),
    ).toBe(path.join(stateDir, "logs", "coding-audit"));
  });
});

describe("JsonlCodingAuditStore", () => {
  it("append-only JSONL preserves old records and reads back valid events", async () => {
    const store = new JsonlCodingAuditStore({ filePath: path.join(root, "audit.jsonl") });
    const first = mutationEvent({ eventId: "evt-first" });
    const second = execEvent({ eventId: "evt-second" });
    await store.appendLine(`${JSON.stringify(first)}\n`);
    await store.appendLine(`${JSON.stringify(second)}\n`);

    const raw = await fs.readFile(store.filePath, "utf8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(first);
    expect(JSON.parse(lines[1]!)).toEqual(second);

    const read = await store.readEvents();
    expect(read.corruptLines).toBe(0);
    expect(read.warnings).toEqual([]);
    expect(read.events.map((event) => event.eventId)).toEqual(["evt-first", "evt-second"]);
  });

  it("skips corrupt tail lines and reports warnings", async () => {
    const store = new JsonlCodingAuditStore({ filePath: path.join(root, "audit.jsonl") });
    const valid = mutationEvent();
    await store.appendLine(`${JSON.stringify(valid)}\n`);
    await store.appendLine("{broken json\n");
    await store.appendLine(`${JSON.stringify(execEvent())}\n`);
    const read = await store.readEvents();
    expect(read.events.map((event) => event.eventId)).toEqual(["evt-mutation-1", "evt-exec-1"]);
    expect(read.corruptLines).toBe(1);
    expect(read.warnings).toHaveLength(1);
  });
});

describe("PersistentCodingAuditSink", () => {
  it("writes a batch asynchronously and flush drains all JSONL lines", async () => {
    const sink = new PersistentCodingAuditSink({
      jsonlPath: path.join(root, "audit", "audit.jsonl"),
      sqlitePath: path.join(root, "audit", "audit.sqlite"),
    });
    for (let i = 0; i < 25; i += 1) {
      sink.write(mutationEvent({ eventId: `evt-${i}`, sessionId: "s-batch" }));
    }
    await sink.flush();
    const raw = await fs.readFile(sink.jsonlPath, "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(25);
    const page = await sink.query("s-batch", {});
    expect(page.items).toHaveLength(25);
    await sink.close();
  });

  it("rejects invalid events synchronously (fail-closed validation)", () => {
    const sink = new PersistentCodingAuditSink({
      jsonlPath: path.join(root, "audit", "audit.jsonl"),
      sqlitePath: path.join(root, "audit", "audit.sqlite"),
    });
    expect(() =>
      sink.write({ ...mutationEvent(), rawCommand: "rm -rf /" } as unknown as CodingAuditEvent),
    ).toThrow(/Invalid coding audit event/);
    expect(isCodingAuditEvent({ ...mutationEvent(), rawCommand: "rm -rf /" })).toBe(false);
    void sink.close();
  });

  it("surfaces JSONL append failures on flush instead of dropping them silently", async () => {
    const jsonlPath = path.join(root, "blocked.jsonl");
    await fs.mkdir(jsonlPath, { recursive: true });
    const sink = new PersistentCodingAuditSink({
      jsonlPath,
      sqlitePath: path.join(root, "audit", "audit.sqlite"),
    });
    sink.write(mutationEvent());
    await expect(sink.flush()).rejects.toThrow();
    await sink.close().catch(() => undefined);
  });

  it("rebuilds SQLite from JSONL when the SQLite file is missing", async () => {
    const logDir = path.join(root, "audit");
    const sink = new PersistentCodingAuditSink({ logDir });
    sink.write(mutationEvent({ sessionId: "s-rebuild" }));
    sink.write(execEvent({ sessionId: "s-rebuild" }));
    await sink.flush();
    await sink.close();

    await fs.rm(path.join(logDir, "coding-audit.sqlite"));
    const reopened = new PersistentCodingAuditSink({ logDir });
    const page = await reopened.query("s-rebuild", {});
    expect(page.items).toHaveLength(2);
    await reopened.close();
  });
});

describe("FileTransactionService durable audit integration", () => {
  it("writes mutation and rollback events to the durable sink and listAudit queries it", async () => {
    const workspace = path.join(root, "work");
    await fs.mkdir(workspace, { recursive: true });
    const sink = new PersistentCodingAuditSink({
      logDir: path.join(root, "audit"),
    });
    const service = new FileTransactionService({
      workspaceRoot: workspace,
      sessionId: "s-fts",
      auditLogSink: sink,
    });

    const prepared = await service.prepare(
      { kind: "write", path: "hello.txt", content: "hello" },
      { sessionId: "s-fts", requestId: "r-fts", workspaceRoot: workspace, toolName: "write" },
    );
    const commit = await service.commit(prepared);
    expect(commit.status).toBe("committed");

    await sink.flush();
    const mutationPage = await service.listAudit("s-fts", {});
    expect(mutationPage.items).toHaveLength(1);
    expect(mutationPage.items[0]?.eventType).toBe(CODING_RUNTIME_EVENT_TYPES.MUTATION);

    const rollback = await service.rollback(commit.batchId);
    expect(rollback.status).toBe("rolled_back");
    await sink.flush();
    const rollbackPage = await service.listAudit("s-fts", { toolName: "rollback" });
    expect(rollbackPage.items).toHaveLength(1);
    expect(rollbackPage.items[0]?.eventType).toBe(CODING_RUNTIME_EVENT_TYPES.ROLLBACK);

    await expect(fs.readFile(path.join(workspace, "hello.txt"), "utf8")).rejects.toThrow();
    await sink.close();
  });

  it("keeps listAudit fail-closed when no durable sink is configured", async () => {
    const service = new FileTransactionService({ workspaceRoot: root, sessionId: "s-no-audit" });
    await expect(service.listAudit("s-no-audit", {})).rejects.toMatchObject({
      code: "E_AUDIT_WRITE_FAILED",
    });
  });
});
