import { afterEach, describe, expect, it } from "vitest";
import {
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
  resolveDiagnosticCodingOperation,
  waitForDiagnosticEventsDrained,
} from "../infra/diagnostic-events.js";
import {
  createDiagnosticTraceContext,
  resetDiagnosticTraceContextForTest,
} from "../infra/diagnostic-trace-context.js";
import {
  wrapToolWithBeforeToolCallHook,
  type HookContext,
} from "./agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "./tools/common.js";

afterEach(() => {
  resetDiagnosticEventsForTest();
  resetDiagnosticTraceContextForTest();
});

function tool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", additionalProperties: false },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AnyAgentTool;
}

describe("agent tool diagnostic lineage", () => {
  it.each([
    ["read_file", "read"],
    ["repo.search", "search"],
    ["apply_patch", "modify"],
    ["run_command", "test"],
    ["result.query", "result_query"],
  ] as const)("classifies %s as %s", (toolName, expected) => {
    expect(resolveDiagnosticCodingOperation(toolName)).toBe(expected);
  });

  it("generates one request and trace lineage for a tool execution", async () => {
    const events: Array<Extract<
      import("../infra/diagnostic-events.js").DiagnosticEventPayload,
      { type: "tool.execution.started" | "tool.execution.completed" }
    >> = [];
    const unsubscribe = onInternalDiagnosticEvent((event) => {
      if (event.type === "tool.execution.started" || event.type === "tool.execution.completed") {
        events.push(event);
      }
    });
    const trace = createDiagnosticTraceContext({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
    });
    const ctx: HookContext = { runId: "run-1", trace };

    await wrapToolWithBeforeToolCallHook(tool("read_file"), ctx).execute(
      "call-1",
      { path: "secret.txt", command: "do-not-record" },
    );
    await waitForDiagnosticEventsDrained();
    unsubscribe();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool.execution.started",
      toolName: "read_file",
      codingOperation: "read",
      runId: "run-1",
      trace: { traceId: trace.traceId },
    });
    expect(events[1]).toMatchObject({
      type: "tool.execution.completed",
      codingOperation: "read",
      trace: { traceId: trace.traceId },
    });
    expect(events[1].requestId).toBe(events[0].requestId);
    expect(events[1].trace.spanId).toBe(events[0].trace.spanId);
    expect(JSON.stringify(events)).not.toContain("do-not-record");
  });

  it("creates a root trace when the tool surface has no supplied trace", async () => {
    const events: Array<Extract<
      import("../infra/diagnostic-events.js").DiagnosticEventPayload,
      { type: "tool.execution.started" }
    >> = [];
    const unsubscribe = onInternalDiagnosticEvent((event) => {
      if (event.type === "tool.execution.started") events.push(event);
    });

    await wrapToolWithBeforeToolCallHook(tool("search_content")).execute("call-2", { query: "needle" });
    await waitForDiagnosticEventsDrained();
    unsubscribe();

    expect(events).toHaveLength(1);
    expect(events[0]?.requestId).toMatch(/^tool-[0-9a-f-]{36}$/u);
    expect(events[0]?.trace.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(events[0]?.codingOperation).toBe("search");
  });
});
