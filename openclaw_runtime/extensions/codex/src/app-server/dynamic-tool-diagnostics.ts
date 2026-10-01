/**
 * Trusted diagnostics emitted around Codex dynamic tool execution lifecycle.
 */
import { randomUUID } from "node:crypto";
import {
  createChildDiagnosticTraceContext,
  createDiagnosticTraceContextFromActiveScope,
  emitTrustedDiagnosticEvent,
  freezeDiagnosticTraceContext,
  type DiagnosticTraceContext,
} from "openclaw/plugin-sdk/diagnostic-runtime";
import type { CodexDynamicToolCallParams, CodexDynamicToolCallResponse } from "./protocol.js";

/** Allocate once per host tool call, then reuse for its start and terminal events.
 * Capture the attempt's parent explicitly: shared-client callbacks may run in
 * the async context of the connection's first caller.
 */
export function createCodexToolDiagnosticIdentity(parent?: DiagnosticTraceContext) {
  return {
    requestId: `tool-${randomUUID()}`,
    trace: freezeDiagnosticTraceContext(
      parent
        ? createChildDiagnosticTraceContext(parent)
        : createDiagnosticTraceContextFromActiveScope(),
    ),
  };
}

type DynamicToolDiagnosticContext = ReturnType<typeof createCodexToolDiagnosticIdentity> & {
  call: CodexDynamicToolCallParams;
  runId?: string | undefined;
  sessionId?: string | undefined;
  sessionKey?: string | undefined;
};

/** Emits a start event for one Codex dynamic tool call. */
export function emitDynamicToolStartedDiagnostic(params: DynamicToolDiagnosticContext): void {
  emitTrustedDiagnosticEvent({
    type: "tool.execution.started",
    requestId: params.requestId,
    trace: params.trace,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    toolName: params.call.tool,
    toolCallId: params.call.callId,
  });
}

/** Emits an error event for one Codex dynamic tool call. */
export function emitDynamicToolErrorDiagnostic(
  params: DynamicToolDiagnosticContext & {
    durationMs: number;
  },
): void {
  emitTrustedDiagnosticEvent({
    type: "tool.execution.error",
    requestId: params.requestId,
    trace: params.trace,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    toolName: params.call.tool,
    toolCallId: params.call.callId,
    durationMs: params.durationMs,
    errorCategory: "codex_dynamic_tool_error",
  });
}

/** Emits the terminal event matching a dynamic tool response's diagnostic type. */
export function emitDynamicToolTerminalDiagnostic(
  params: DynamicToolDiagnosticContext & {
    response: CodexDynamicToolCallResponse;
    durationMs: number;
  },
): void {
  const terminalType =
    params.response.diagnosticTerminalType ?? (params.response.success ? "completed" : "error");
  if (terminalType === "completed") {
    emitTrustedDiagnosticEvent({
      type: "tool.execution.completed",
      requestId: params.requestId,
      trace: params.trace,
      runId: params.runId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      toolName: params.call.tool,
      toolCallId: params.call.callId,
      durationMs: params.durationMs,
    });
    return;
  }
  if (terminalType === "blocked") {
    emitTrustedDiagnosticEvent({
      type: "tool.execution.blocked",
      requestId: params.requestId,
      trace: params.trace,
      runId: params.runId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      toolName: params.call.tool,
      toolCallId: params.call.callId,
      deniedReason: "plugin-before-tool-call",
      reason: "Tool call blocked",
    });
    return;
  }
  emitDynamicToolErrorDiagnostic(params);
}
