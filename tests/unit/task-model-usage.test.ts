// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain, type TaskAuthorityAccess } from "../../shared/task-system/identity";
import { normalizeRunScope, type ScopedRunId } from "../../shared/types/identity-scope";
import { readTaskTrace, type TaskModelUsage } from "../../shared/task-system/trace";
import {
  createTaskRuntimeGuard,
  createTaskModelUsageRecorder,
} from "../../shared/task-system/runtime";
import { createModelCallUsageObserver } from "../../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-call-usage";
import { wrapStreamFnWithDiagnosticModelCallEvents } from "../../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events";
import { createAssistantMessageEventStream } from "../../openclaw_runtime/src/llm/utils/event-stream";
import { createDiagnosticTraceContext } from "../../openclaw_runtime/src/infra/diagnostic-trace-context";
import type { AssistantMessage, Model } from "../../openclaw_runtime/src/llm/types";

const fixtures: Array<{ store: TaskSystemStore; root: string }> = [];
function fixture(provenance?: TaskAuthorityAccess["runProvenance"]) {
  const root = mkdtempSync(join(tmpdir(), "v1-model-usage-"));
  const domain = resolveTaskDomain(root);
  const store = new TaskSystemStore(
    domain,
    undefined,
    provenance
      ? {
          domain,
          assertCurrent() {},
          resolveRelated: resolveTaskDomain,
          runProvenance: provenance,
        }
      : undefined,
  );
  fixtures.push({ store, root });
  const task = store.start(
    {
      contract: {
        objective: "Retain attributed cost",
        target: ".",
        constraints: [],
        acceptance: [
          {
            id: "check",
            description: "Owner check",
            verification: { kind: "owner-receipt", owner: "fixture" },
          },
        ],
      },
    },
    "writer",
    "generation-a",
    "start",
  );
  return { root, store, task, credential: task.claim! };
}
const usage = (overrides: Partial<TaskModelUsage> = {}): TaskModelUsage => ({
  terminal: "done",
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
  costUsd: 0.02,
  priceVersion: "a".repeat(64),
  toolCallIdHashes: [],
  endedAt: Date.now() + 10,
  ...overrides,
});
afterEach(() => {
  fixtures.splice(0).forEach((f) => {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  });
});

describe("Task model-call attribution", () => {
  it("links a call preceding checkout admission to its original settled run without rewriting the call", () => {
    const state: { run?: ScopedRunId } = {};
    const f = fixture(() => (state.run ? { run: state.run } : {}));
    f.store.beginModelCall(f.credential, {
      callId: "before-checkout",
      runId: "original-run",
      provider: "provider",
      model: "model",
    });
    f.store.beginRun(f.credential, "original-run");
    f.store.recordModelUsage(f.credential, "before-checkout", usage());
    state.run = normalizeRunScope({
      runId: "original-run",
      scope: {
        workspaceId: "original-project",
        projectId: "original-project",
        sessionKey: "writer",
      },
    });
    f.store.endRun(f.credential, "original-run");
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(report.costs.records[0].run).toEqual(state.run);
    expect(report.costs.records[0].call.provenance).toEqual({});
    expect(report.diagnostics).not.toContainEqual({
      code: "source_identity_unknown",
      ref: "before-checkout",
    });
  });
  it("links a child call to the child's run in a parent cost report", () => {
    const state: { run?: ScopedRunId } = {};
    const f = fixture(() => (state.run ? { run: state.run } : {}));
    const [child] = f.store.decompose(
      f.credential,
      [
        {
          key: "child",
          contract: {
            objective: "Child execution",
            target: ".",
            constraints: [],
            acceptance: [
              {
                id: "check",
                description: "Check",
                verification: { kind: "owner-receipt", owner: "fixture" },
              },
            ],
          },
        },
      ],
      "child-plan",
    );
    const claim = f.store.claim(
      child.contract.taskNodeId,
      "child-session",
      "child-generation",
      "child-claim",
    ).claim!;
    f.store.beginModelCall(claim, {
      callId: "child-before-checkout",
      runId: "child-run",
      provider: "provider",
      model: "model",
    });
    f.store.beginRun(claim, "child-run");
    f.store.recordModelUsage(claim, "child-before-checkout", usage());
    state.run = normalizeRunScope({
      runId: "child-run",
      scope: {
        workspaceId: "original-project",
        projectId: "original-project",
        sessionKey: "child-session",
      },
    });
    f.store.endRun(claim, "child-run");
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(report.runs).toEqual([]);
    expect(report.costs.records[0].run).toEqual(state.run);
    expect(report.costs.calls).toBe(1);
    expect(report.costs.totalUsd).toBe(0.02);
  });
  it("keeps an unlinked original call unknown when a later owner reuses the run id", () => {
    const state: { run?: ScopedRunId } = {};
    const f = fixture(() => (state.run ? { run: state.run } : {}));
    f.store.beginModelCall(f.credential, {
      callId: "old-call",
      runId: "same-run-id",
      provider: "provider",
      model: "model",
    });
    const next = f.store.handoff(f.credential, "next-writer", "generation-b");
    state.run = normalizeRunScope({
      runId: "same-run-id",
      scope: {
        workspaceId: "original-project",
        projectId: "original-project",
        sessionKey: "next-writer",
      },
    });
    f.store.beginRun(next.claim!, "same-run-id");
    f.store.endRun(next.claim!, "same-run-id");
    f.store.recordModelUsage(f.credential, "old-call", usage());
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(report.costs.records[0].run).toBeNull();
    expect(report.diagnostics).toContainEqual({ code: "source_identity_unknown", ref: "old-call" });
  });
  it("retains one original call when identical observations are replayed", () => {
    const f = fixture();
    const call = { callId: "physical-a", runId: "run-a", provider: "provider", model: "model" };
    f.store.beginModelCall(f.credential, call);
    f.store.beginModelCall(f.credential, call);
    const observed = usage();
    f.store.recordModelUsage(f.credential, call.callId, observed);
    f.store.recordModelUsage(f.credential, call.callId, observed);
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(report.costs).toMatchObject({
      calls: 1,
      totalUsd: 0.02,
      totalTokens: 15,
      state: "estimated",
    });
    expect(
      f.store.history(f.task.contract.taskNodeId).filter((event) => event.kind === "model_usage"),
    ).toHaveLength(1);
  });
  it("preserves known subtotal and unknown final cost when a call has no price", () => {
    const f = fixture();
    for (const id of ["priced", "unpriced"])
      f.store.beginModelCall(f.credential, {
        callId: id,
        runId: "run-a",
        provider: "provider",
        model: "model",
      });
    f.store.recordModelUsage(f.credential, "priced", usage());
    f.store.recordModelUsage(
      f.credential,
      "unpriced",
      usage({ costUsd: null, priceVersion: null }),
    );
    expect(
      readTaskTrace(f.store, { taskNodeId: f.task.contract.taskNodeId }, () => "fixture").costs,
    ).toMatchObject({
      calls: 2,
      totalUsd: null,
      knownSubtotalUsd: 0.02,
      state: "unknown",
      unknownCalls: 1,
    });
  });
  it("keeps late usage on the original generation after handoff and rejects a wrong owner", () => {
    const f = fixture(),
      recorder = createTaskModelUsageRecorder(
        createTaskRuntimeGuard(f.root, "writer", "generation-a", "run-a"),
      );
    recorder.start("physical-late", "provider", "model");
    const next = f.store.handoff(f.credential, "next-writer", "generation-b");
    recorder.finish("physical-late", usage());
    const record = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    ).costs.records[0];
    expect(record.call.credential).toMatchObject({
      sessionKey: "writer",
      generation: "generation-a",
      epoch: f.credential.epoch,
    });
    expect(() => f.store.recordModelUsage(next.claim!, "physical-late", usage())).toThrow(
      "TASK_MODEL_CALL_REQUIRED",
    );
  });
  it("retains a conflict receipt and makes the amount unknown without rewriting the original", () => {
    const f = fixture(),
      observed = usage();
    f.store.beginModelCall(f.credential, {
      callId: "physical-conflict",
      runId: "run-a",
      provider: "provider",
      model: "model",
    });
    expect(f.store.recordModelUsage(f.credential, "physical-conflict", observed)).toBe(true);
    expect(
      f.store.recordModelUsage(f.credential, "physical-conflict", { ...observed, costUsd: 999 }),
    ).toBe(false);
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(report.costs.totalUsd).toBeNull();
    expect(report.costs.records[0].usage).toBeNull();
    expect(report.diagnostics).toContainEqual({ code: "cost_conflict", ref: "physical-conflict" });
    expect(
      JSON.parse(
        f.store.history(f.task.contract.taskNodeId).find((event) => event.kind === "model_usage")!
          .json,
      ).usage,
    ).toEqual(observed);
  });
  it("rolls up original child receipts once and never adds a parent total", () => {
    const f = fixture();
    const [child] = f.store.decompose(
      f.credential,
      [
        {
          key: "child",
          contract: {
            objective: "Child invocation",
            target: ".",
            constraints: [],
            acceptance: [
              {
                id: "check",
                description: "Check",
                verification: { kind: "owner-receipt", owner: "fixture" },
              },
            ],
          },
        },
      ],
      "decompose",
    );
    const claim = f.store.claim(
      child.contract.taskNodeId,
      "child-session",
      "child-generation",
      "child-claim",
    ).claim!;
    f.store.beginModelCall(claim, {
      callId: "physical-child",
      runId: "run-child",
      provider: "provider",
      model: "model",
    });
    const observed = usage();
    f.store.recordModelUsage(claim, "physical-child", observed);
    const childReport = readTaskTrace(
      f.store,
      { taskNodeId: child.contract.taskNodeId },
      () => "fixture",
    );
    const parentReport = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(childReport.costs.totalUsd).toBe(0.02);
    expect(parentReport.costs.totalUsd).toBe(0.02);
    expect(parentReport.costs.calls).toBe(1);
    expect(parentReport.costs.records[0].call.credential.taskNodeId).toBe(
      child.contract.taskNodeId,
    );
  });
  it("uses the existing usage observer and keeps zero catalog fallback prices unknown", () => {
    const observer = createModelCallUsageObserver({
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    observer.observe({
      type: "done",
      message: {
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
        content: [],
      },
    });
    expect(observer.finish()).toMatchObject({
      costUsd: null,
      price: { state: "unknown", version: null },
    });
  });
  it("records a coordinator model call while a delegated writer keeps its own claim", () => {
    const f = fixture();
    const delegation = f.store.prepareWriterDelegation(f.credential, {
      delegationId: "writer-delegation",
      childSessionKey: "child-session",
      childGeneration: "child-generation",
      childRunId: "child-run",
      childWorktree: f.root,
      mode: "writer",
    });
    const parent = createTaskModelUsageRecorder(
      createTaskRuntimeGuard(f.root, "writer", "generation-a", "coordinator-run"),
    );
    const child = createTaskModelUsageRecorder(
      createTaskRuntimeGuard(f.root, "child-session", "child-generation", "child-run"),
    );
    parent.start("coordinator-call", "provider", "model");
    child.start("child-call", "provider", "model");
    parent.finish("coordinator-call", usage());
    child.finish("child-call", usage());
    const trace = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(trace.costs.calls).toBe(2);
    expect(trace.costs.totalUsd).toBe(0.04);
    expect(trace.costs.records.map((record) => record.call.actorRole)).toEqual([
      "coordinator",
      "assigned",
    ]);
    expect(f.store.get(f.task.contract.taskNodeId).claim).toMatchObject(delegation.child);
    expect(() => f.store.beginOperation(f.credential, "parent-write", "write")).toThrow(
      "TASK_STALE_OWNER",
    );
  });
  it("records actual terminal stream usage while the diagnostic cost flag stays off", async () => {
    const f = fixture(),
      recorder = createTaskModelUsageRecorder(
        createTaskRuntimeGuard(f.root, "writer", "generation-a", "run-a"),
      );
    const message = {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "fixture-provider",
      model: "fixture-model",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } as AssistantMessage;
    const streamFn = wrapStreamFnWithDiagnosticModelCallEvents(
      () => {
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      },
      {
        runId: "run-a",
        sessionKey: "writer",
        sessionId: "generation-a",
        provider: "fixture-provider",
        model: "fixture-model",
        trace: createDiagnosticTraceContext(),
        nextCallId: () => "logical-model-call",
        costDiagnosticsEnabled: false,
        onUsageStarted: ({ callId }) => recorder.start(callId, "fixture-provider", "fixture-model"),
        onUsage: ({ callId, endedAt, snapshot }) =>
          recorder.finish(callId, {
            terminal: snapshot.terminal,
            usage: snapshot.usage,
            costUsd: snapshot.costUsd,
            priceVersion: snapshot.price.version,
            toolCallIdHashes: snapshot.toolCallIdHashes,
            endedAt,
          }),
      },
    );
    const stream = await streamFn(
      {
        provider: "fixture-provider",
        id: "fixture-model",
        api: "openai-completions",
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );
    for await (const event of stream) expect(event.type).toBe("done");
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.task.contract.taskNodeId },
      () => "fixture",
    );
    expect(report.costs).toMatchObject({
      calls: 1,
      totalTokens: 15,
      state: "estimated",
      totalUsd: 0.00002,
    });
  });
});
