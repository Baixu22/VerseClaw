import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { toToolDefinitions } from "../agent-tool-definition-adapter.js";
import type { AgentContext, AgentMessage, AgentTool } from "../runtime/index.js";
import { makeMissingToolResult, repairToolUseResultPairing } from "../session-transcript-repair.js";
import { redispatchPendingToolCalls } from "./redispatch.js";
import { authorizePendingToolRecovery } from "./recovery.js";
import { readOpenExecutionPhases } from "./store.js";
import { recordAssistantToolDispatches } from "./tool-boundary.js";

vi.mock("../../plugins/hook-runner-global.js", () => ({ getGlobalHookRunner: () => undefined }));
const identity = {
  sessionKey: "agent:main:recovery",
  sessionId: "generation-1",
  runId: "original-run",
};
const assistant = {
  role: "assistant",
  content: [
    { type: "toolCall", id: "call-1", name: "write", arguments: { value: "private-input" } },
  ],
  stopReason: "toolUse",
  api: "anthropic-messages",
  provider: "test",
  model: "test",
  timestamp: 1,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
} satisfies AgentMessage;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "redispatch-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", dir);
  vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
  vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
});
afterEach(() => {
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function setup(
  execute = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "actual-result" }],
    details: {},
  })),
) {
  const [tool] = toToolDefinitions(
    [
      {
        name: "write",
        label: "write",
        description: "test effect",
        parameters: Type.Object({ value: Type.String() }),
        execute,
      },
    ],
    { ...identity, runId: "recovery-run" },
  );
  const adapted: AgentTool = {
    ...tool,
    execute: (id, args, signal, onUpdate) =>
      tool.execute(id, args, signal, onUpdate, undefined as never),
  };
  const context: AgentContext = { systemPrompt: "", messages: [assistant], tools: [adapted] };
  const persisted: AgentMessage[] = [];
  const appendResult = (message: Extract<AgentMessage, { role: "toolResult" }>) => {
    persisted.push(message);
    return `entry-${persisted.length}`;
  };
  return { context, execute, persisted, appendResult };
}

describe("deterministic recovery through the actual tool adapter", () => {
  it("executes original arguments once and replaces repair noise with the real result", async () => {
    const run = setup();
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    run.context.messages.push(makeMissingToolResult({ toolCallId: "call-1", toolName: "write" }));
    const messages = await redispatchPendingToolCalls({ ...identity, ...run, config: {} });
    expect(run.execute).toHaveBeenCalledTimes(1);
    expect(run.execute).toHaveBeenCalledWith(
      "call-1",
      { value: "private-input" },
      undefined,
      expect.any(Function),
    );
    expect(run.persisted).toHaveLength(1);
    expect(readOpenExecutionPhases(identity.sessionKey)[0].phase).toBe("effect_committed");
    const repaired = repairToolUseResultPairing(messages).messages;
    expect(repaired.filter((m) => m.role === "toolResult")).toMatchObject([
      { content: [{ text: "actual-result" }] },
    ]);
    await redispatchPendingToolCalls({
      ...identity,
      ...run,
      context: { ...run.context, messages },
      config: {},
    });
    expect(run.execute).toHaveBeenCalledTimes(1);
  });
  it("commits effect_pending BEFORE the real tool executes", async () => {
    const execute = vi.fn(async () => {
      expect(readOpenExecutionPhases(identity.sessionKey)[0].phase).toBe("effect_pending");
      return { content: [{ type: "text" as const, text: "actual-result" }], details: {} };
    });
    const run = setup(execute);
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    await redispatchPendingToolCalls({ ...identity, ...run, config: {} });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("keeps policy denial and cancellation ahead of effect execution", async () => {
    const run = setup();
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    await redispatchPendingToolCalls({
      ...identity,
      ...run,
      config: { beforeToolCall: async () => ({ block: true, reason: "policy denied" }) },
    });
    expect(run.execute).not.toHaveBeenCalled();
    expect(run.persisted[0]).toMatchObject({ isError: true });
    await expect(
      redispatchPendingToolCalls({ ...identity, ...run, config: {}, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(run.execute).not.toHaveBeenCalled();
  });
  it("preserves uncertain phase when the tool throws after an effect", async () => {
    const run = setup(
      vi.fn(async () => {
        throw new Error("after external commit");
      }),
    );
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    await redispatchPendingToolCalls({ ...identity, ...run, config: {} });
    const row = readOpenExecutionPhases(identity.sessionKey)[0];
    expect(row.phase).toBe("effect_pending");
    expect(row.recovery_json).toContain("needsReconciliation");
    await expect(redispatchPendingToolCalls({ ...identity, ...run, config: {} })).rejects.toThrow(
      "reconciliation",
    );
    expect(run.execute).toHaveBeenCalledTimes(1);
  });
  it("requires the interrupted session owner to authorize recovery", async () => {
    const run = setup();
    recordAssistantToolDispatches(assistant, identity);
    await expect(redispatchPendingToolCalls({ ...identity, ...run, config: {} })).rejects.toThrow(
      "owner has not authorized",
    );
    expect(run.execute).not.toHaveBeenCalled();
  });
  it("stops when a transcript write hook suppresses the recovered result", async () => {
    const run = setup();
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    await expect(
      redispatchPendingToolCalls({
        ...identity,
        ...run,
        config: {},
        appendResult: () => undefined,
      }),
    ).rejects.toThrow("not persisted");
    expect(run.execute).toHaveBeenCalledTimes(1);
    await expect(redispatchPendingToolCalls({ ...identity, ...run, config: {} })).rejects.toThrow(
      "reconciliation",
    );
    expect(run.execute).toHaveBeenCalledTimes(1);
  });
  it("does not execute when a durable dispatch write is unavailable", async () => {
    const run = setup();
    closeOpenClawStateDatabase();
    vi.stubEnv("OPENCLAW_STATE_DIR", join(dir, "not-a-directory"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "not-a-directory"), "blocked");
    const tool = run.context.tools![0];
    await tool.execute("call-1", { value: "private-input" });
    expect(run.execute).not.toHaveBeenCalled();
  });
});
