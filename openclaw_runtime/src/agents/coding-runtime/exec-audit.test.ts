import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCodingAuditEvent } from "../../../../shared/coding-runtime/schema.js";
import { CODING_RUNTIME_EVENT_TYPES, type CodingExecEvent } from "../../../../shared/coding-runtime/types.js";
import { InMemoryCodingAuditSink, resetCodingAuditSinkForTest, setCodingAuditSink } from "./audit-sink.js";
import { normalizeCommandApprovalPolicy } from "./command-approval-policy.js";
import {
  buildCodingExecEvent,
  captureWorkspaceSnapshot,
  diffWorkspaceSnapshots,
  ExecAuditor,
} from "./exec-audit.js";

let workspace: string;
let sink: InMemoryCodingAuditSink;

function firstExecEvent(): CodingExecEvent | undefined {
  const event = sink.query("s1").items[0];
  return event?.eventType === CODING_RUNTIME_EVENT_TYPES.EXEC ? event : undefined;
}

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-exec-audit-"));
  sink = new InMemoryCodingAuditSink();
  setCodingAuditSink(sink);
});

afterEach(async () => {
  resetCodingAuditSinkForTest();
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("captureWorkspaceSnapshot", () => {
  it("captures workspace files with hashes and skips configured directories", async () => {
    await fs.mkdir(path.join(workspace, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(workspace, "a.txt"), "hello");
    await fs.writeFile(path.join(workspace, "node_modules", "dep.js"), "ignored");
    const snapshot = await captureWorkspaceSnapshot(workspace, { skipDirs: ["node_modules"] });
    expect(snapshot.files.has("a.txt")).toBe(true);
    expect(snapshot.files.has("node_modules/dep.js")).toBe(false);
    expect(snapshot.files.get("a.txt")?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.truncated).toBe(false);
  });

  it("marks snapshot truncated when the file limit is reached", async () => {
    await fs.writeFile(path.join(workspace, "a.txt"), "a");
    await fs.writeFile(path.join(workspace, "b.txt"), "b");
    const snapshot = await captureWorkspaceSnapshot(workspace, { maxFiles: 1 });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.files.size).toBe(1);
  });
});

describe("diffWorkspaceSnapshots", () => {
  it("detects added, modified, and deleted files", async () => {
    await fs.writeFile(path.join(workspace, "mod.txt"), "before");
    await fs.writeFile(path.join(workspace, "del.txt"), "gone");
    const before = await captureWorkspaceSnapshot(workspace);

    await fs.writeFile(path.join(workspace, "mod.txt"), "after");
    await fs.rm(path.join(workspace, "del.txt"));
    await fs.writeFile(path.join(workspace, "add.txt"), "new");
    const after = await captureWorkspaceSnapshot(workspace);

    const effects = diffWorkspaceSnapshots(before, after);
    expect(effects).toHaveLength(3);
    const byPath = Object.fromEntries(effects.map((effect) => [effect.path, effect.status]));
    expect(byPath).toEqual({
      "add.txt": "added",
      "del.txt": "deleted",
      "mod.txt": "modified",
    });
  });
});

describe("buildCodingExecEvent", () => {
  it("builds a schema-valid exec event without raw command text", () => {
    const event = buildCodingExecEvent({
      sessionId: "s1",
      requestId: "r1",
      workspaceRoot: workspace,
      command: "pnpm test -- --run",
      cwd: workspace,
      status: "succeeded",
      exitCode: 0,
      durationMs: 12,
      outputTruncated: false,
      sideEffects: [],
    });
    expect(isCodingAuditEvent(event)).toBe(true);
    expect(event.commandRedacted).toBeTypeOf("string");
    expect("command" in event).toBe(false);
    expect(JSON.stringify(event)).not.toContain('"command"');
  });
});

describe("ExecAuditor", () => {
  it("does not write events when disabled", async () => {
    const auditor = new ExecAuditor({ workspaceRoot: workspace, sessionId: "s1" });
    await expect(auditor.captureBefore()).resolves.toBeNull();
    expect(sink.size).toBe(0);
  });

  it("records a running/succeeded event with side effects to the unified sink", async () => {
    await fs.writeFile(path.join(workspace, "a.txt"), "before");
    const auditor = new ExecAuditor({
      workspaceRoot: workspace,
      sessionId: "s1",
      enabled: true,
      sideEffectsEnabled: true,
      snapshot: { skipDirs: [] },
    });
    const before = await auditor.captureBefore();
    expect(before).not.toBeNull();

    await fs.writeFile(path.join(workspace, "a.txt"), "after");
    const event = await auditor.recordExecEvent({
      before,
      command: "node -e \"require('fs').writeFileSync('a.txt','after')\"",
      requestId: "r1",
      startedAtMs: Date.now() - 5,
      approval: null,
      status: "succeeded",
      exitCode: 0,
      outputTruncated: false,
    });
    expect(event.status).toBe("succeeded");
    expect(event.sideEffects.some((effect) => effect.path === "a.txt" && effect.status === "modified")).toBe(true);
    expect(sink.size).toBe(1);
    expect(firstExecEvent()?.eventId).toBe(event.eventId);
  });

  it("records forbidden decisions with status denied through the policy evaluator", async () => {
    const auditor = new ExecAuditor({
      workspaceRoot: workspace,
      sessionId: "s1",
      enabled: true,
      commandApprovalEnabled: true,
      commandApprovalPolicy: normalizeCommandApprovalPolicy({
        defaultDecision: "allow",
        rules: [{ prefix: "rm -rf", decision: "forbidden" }],
      }),
    });
    const approval = auditor.evaluateApproval("rm -rf ./out");
    expect(approval?.decision).toBe("forbidden");
    await auditor.recordExecEvent({
      before: null,
      command: "rm -rf ./out",
      requestId: "r1",
      startedAtMs: Date.now(),
      approval,
      status: "denied",
      exitCode: null,
      outputTruncated: false,
      error: "Command forbidden by UFTK command approval policy",
    });
    expect(sink.size).toBe(1);
    expect(firstExecEvent()?.status).toBe("denied");
    expect(firstExecEvent()?.approval?.decision).toBe("forbidden");
  });
});
