import type { EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";
import {
  isValidDiagnosticTraceId,
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
  waitForDiagnosticEventsDrained,
  type DiagnosticEventPayload,
} from "openclaw/plugin-sdk/diagnostic-runtime";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildCodexSystemPromptReport } from "./attempt-context.js";
import {
  createCodexToolDiagnosticIdentity,
  emitDynamicToolStartedDiagnostic,
  emitDynamicToolTerminalDiagnostic,
} from "./dynamic-tool-diagnostics.js";
import { createCodexDynamicToolBridge } from "./dynamic-tools.js";
import { CodexAppServerEventProjector } from "./event-projector.js";

type ToolEvent = Extract<DiagnosticEventPayload, { type: `tool.execution.${string}` }>;
let events: ToolEvent[];
let unsubscribe: () => void;
beforeEach(() => {
  resetDiagnosticEventsForTest();
  events = [];
  unsubscribe = onInternalDiagnosticEvent((event) => {
    if (event.type.startsWith("tool.execution.")) events.push(event as ToolEvent);
  });
});
afterEach(async () => {
  await waitForDiagnosticEventsDrained();
  unsubscribe();
  resetDiagnosticEventsForTest();
});

it.each(["completed", "blocked", "error"] as const)(
  "pairs dynamic start and %s with one host identity",
  async (terminal) => {
    const context = {
      ...createCodexToolDiagnosticIdentity({
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        traceFlags: "01",
      }),
      call: { threadId: "thread", turnId: "turn", callId: "call", tool: "read", arguments: {} },
      runId: "run",
    };
    emitDynamicToolStartedDiagnostic(context);
    emitDynamicToolTerminalDiagnostic({
      ...context,
      response: {
        success: terminal === "completed",
        contentItems: [],
        diagnosticTerminalType: terminal,
      },
      durationMs: 12,
    });
    await waitForDiagnosticEventsDrained();
    expect(events.map((event) => event.type)).toEqual([
      "tool.execution.started",
      `tool.execution.${terminal}`,
    ]);
    expect(events[0]!.requestId).toBe(events[1]!.requestId);
    expect(events[0]!.trace).toEqual(events[1]!.trace);
    expect(isValidDiagnosticTraceId(events[0]!.trace.traceId)).toBe(true);
    expect(events[0]!.trace.traceId).toBe("a".repeat(32));
    expect(events[0]!.trace.parentSpanId).toBe("b".repeat(16));
    expect(Object.isFrozen(context.trace)).toBe(true);
    expect(createCodexToolDiagnosticIdentity().requestId).not.toBe(context.requestId);
  },
);

it("keeps interleaved native tool events paired without sharing request ids", async () => {
  const projector = new CodexAppServerEventProjector(
    {
      runId: "run",
      sessionId: "session",
      model: { api: "openai-responses" },
      provider: "codex",
    } as EmbeddedRunAttemptParams,
    "thread",
    "turn",
    { trace: { traceId: "c".repeat(32), spanId: "d".repeat(16) } },
  );
  for (const [method, id, status] of [
    ["item/started", "a", "inProgress"],
    ["item/started", "b", "inProgress"],
    ["item/completed", "b", "completed"],
    ["item/completed", "a", "completed"],
  ]) {
    await projector.handleNotification({
      method: method!,
      params: {
        threadId: "thread",
        turnId: "turn",
        item: {
          id,
          type: "commandExecution",
          command: "echo fixture",
          cwd: "/fixture",
          status,
          exitCode: status === "completed" ? 0 : null,
          aggregatedOutput: "",
          durationMs: 10,
        },
      },
    } as Parameters<typeof projector.handleNotification>[0]);
  }
  await waitForDiagnosticEventsDrained();
  expect(events).toHaveLength(4);
  for (const id of ["a", "b"]) {
    const pair = events.filter((event) => event.toolCallId === id);
    expect(pair.map((event) => event.type)).toEqual([
      "tool.execution.started",
      "tool.execution.completed",
    ]);
    expect(pair[0]!.requestId).toBe(pair[1]!.requestId);
    expect(pair[0]!.trace).toEqual(pair[1]!.trace);
    expect(isValidDiagnosticTraceId(pair[0]!.trace.traceId)).toBe(true);
    expect(pair[0]!.trace.traceId).toBe("c".repeat(32));
  }
  expect(events[0]!.requestId).not.toBe(events[1]!.requestId);
});

it("emits a valid standalone blocked event for an unreadable tool schema", async () => {
  const bridge = createCodexDynamicToolBridge({
    tools: [
      {
        name: "broken",
        description: "fixture",
        get parameters() {
          throw new Error("unreadable schema");
        },
      },
    ] as never,
    signal: new AbortController().signal,
    hookContext: {
      runId: "quarantine",
      trace: { traceId: "e".repeat(32), spanId: "f".repeat(16) },
    },
  });
  await waitForDiagnosticEventsDrained();
  expect(bridge.specs).toHaveLength(0);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "tool.execution.blocked",
    deniedReason: "unsupported_tool_schema",
  });
  expect(events[0]!.requestId).toMatch(/^tool-/);
  expect(isValidDiagnosticTraceId(events[0]!.trace.traceId)).toBe(true);
  expect(events[0]!.trace.traceId).toBe("e".repeat(32));
});

it("reports the shared tool-definition total with existing native/deferred accounting", () => {
  const schema = { type: "object", properties: { path: { type: "string" } } };
  const report = buildCodexSystemPromptReport({
    attempt: { sessionId: "session" } as EmbeddedRunAttemptParams,
    sessionKey: "session",
    workspaceDir: "/fixture",
    developerInstructions: "base",
    skillsPrompt: "",
    workspaceBootstrapContext: { bootstrapFiles: [], contextFiles: [] },
    tools: [
      { name: "read", description: "read", inputSchema: schema },
      { name: "deferred", description: "deferred", inputSchema: schema, deferLoading: true },
    ],
  });
  expect(report.tools.listChars).toBe(0);
  expect(report.tools.schemaChars).toBe(JSON.stringify(schema).length);
  expect(report.tools.definitionChars).toBe(report.tools.listChars + report.tools.schemaChars);
});
