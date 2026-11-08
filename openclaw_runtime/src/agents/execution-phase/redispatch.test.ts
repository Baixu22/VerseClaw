import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { toToolDefinitions } from "../agent-tool-definition-adapter.js";
import { createSubscribedSessionHarness } from "../embedded-agent-subscribe.e2e-harness.js";
import type { AgentContext, AgentMessage, AgentTool } from "../runtime/index.js";
import { makeMissingToolResult, repairToolUseResultPairing } from "../session-transcript-repair.js";
import { redispatchPendingToolCalls } from "./redispatch.js";
import { authorizePendingToolRecovery, redispatchAdmittedSessionTools } from "./recovery.js";
import {
  prepareOwnerRecoveryAdmission,
  finishOwnerRecoveryAdmission,
} from "../recovery-authority/owner-admission.js";
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
  it("records a recovered messaging effect through the session event owner", async () => {
    const args = {
      action: "send",
      channel: "telegram",
      target: "fixture-target",
      message: "original delivery",
    };
    const pending: AgentMessage = {
      ...assistant,
      content: [{ type: "toolCall", id: "message-call", name: "message", arguments: args }],
    };
    const execute = vi.fn<AgentTool["execute"]>(async (_id, _args, _signal, onUpdate) => {
      onUpdate?.({ content: [{ type: "text", text: "sending" }], details: {} });
      return { content: [{ type: "text" as const, text: "sent" }], details: { status: "sent" } };
    });
    const [tool] = toToolDefinitions(
      [
        {
          name: "message",
          label: "message",
          description: "local delivery fixture",
          parameters: Type.Object({
            action: Type.String(),
            channel: Type.String(),
            target: Type.String(),
            message: Type.String(),
          }),
          execute,
        },
      ],
      { ...identity, runId: "recovery-run" },
    );
    const context: AgentContext = {
      systemPrompt: "",
      messages: [pending],
      tools: [
        {
          ...tool,
          execute: (id, input, signal, onUpdate) =>
            tool.execute(id, input, signal, onUpdate, undefined as never),
        },
      ],
    };
    const { subscription } = createSubscribedSessionHarness({
      runId: "recovery-run",
      sessionKey: identity.sessionKey,
      builtinToolNames: new Set(["message"]),
    });
    const persisted: AgentMessage[] = [];
    const events: string[] = [];
    recordAssistantToolDispatches(pending, identity);
    authorizePendingToolRecovery({ ...identity, messages: context.messages });
    try {
      await redispatchPendingToolCalls({
        ...identity,
        context,
        config: {},
        appendResult: (message) => {
          persisted.push(message);
          return "persisted-result";
        },
        onEvent: (event) => {
          events.push(event.type);
          subscription.handleSessionEvent?.(event);
        },
      });
      await subscription.waitForPendingEvents();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(persisted).toHaveLength(1);
      expect(subscription.didSendViaMessagingTool()).toBe(true);
      expect(subscription.getMessagingToolSentTexts()).toEqual(["original delivery"]);
      expect(subscription.getItemLifecycle()).toMatchObject({
        startedCount: 1,
        completedCount: 1,
        activeCount: 0,
      });
      expect(events).toEqual(
        expect.arrayContaining([
          "tool_execution_start",
          "tool_execution_update",
          "tool_execution_end",
        ]),
      );
    } finally {
      subscription.unsubscribe();
    }
  });

  it("resumes an aborted text tail from its durable user intent without deleting transcript evidence", async () => {
    const run = setup();
    const user: AgentMessage = { role: "user", content: "finish the original task", timestamp: 1 };
    const partial: AgentMessage = {
      ...assistant,
      content: [{ type: "text", text: "interrupted output" }],
      stopReason: "aborted",
    };
    const original = [user, partial];
    run.context.messages = original;
    const messages = await redispatchAdmittedSessionTools({
      ...identity,
      ...run,
      runId: "recovery-run",
      config: {},
      entry: {
        sessionId: identity.sessionId,
        updatedAt: 1,
        restartRecovery: {
          sessionId: identity.sessionId,
          boundary: "original-intent",
          runId: "recovery-run",
          attempts: 1,
          state: "admitted",
        },
      },
    });
    expect(messages).toEqual([user]);
    expect(original).toEqual([user, partial]);
    expect(run.persisted).toEqual([]);
    expect(run.execute).not.toHaveBeenCalled();
  });
  it.each(["pending", "accepted", "reconcile"] as const)(
    "executes the original subagent call with %s admission",
    async (state) => {
      const run = setup();
      recordAssistantToolDispatches(assistant, identity);
      authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
      const admission = prepareOwnerRecoveryAdmission({
        requestId: "subagent-resume",
        entry: "subagent-orphan",
        owner: {
          kind: "subagent-run",
          ownerId: identity.runId,
          runId: identity.runId,
          sessionKey: identity.sessionKey,
        },
        admission: {
          trigger: "gateway-restart",
          requiredPreState: "active-subagent-run",
          admitted: true,
          visibleOutputObserved: false,
        },
        budget: {
          attempts: { current: 0, max: 2 },
          backoff: { initialMs: 5000, multiplier: 2 },
          wedge: { afterAttempts: 2, wedged: false },
        },
        replayClass: "reconcile",
        effect: "not_applied",
        requestedAction: "resume",
        idempotencyKey: "recovery-run",
        evidence: [],
        requestedAt: Date.now(),
      });
      if (!admission.admitted) throw new Error("subagent admission missing");
      const record =
        state === "pending"
          ? admission.record
          : finishOwnerRecoveryAdmission(admission.record, admission.record, state)!;
      const entry = {
        sessionId: identity.sessionId,
        updatedAt: Date.now(),
        subagentRecovery: { authority: record },
      };
      const messages = await redispatchAdmittedSessionTools({
        ...identity,
        ...run,
        entry,
        runId: "recovery-run",
        config: {},
      });
      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.persisted[0]).toMatchObject({
        toolCallId: "call-1",
        content: [{ text: "actual-result" }],
      });
      await redispatchAdmittedSessionTools({
        ...identity,
        ...run,
        entry,
        runId: "recovery-run",
        config: {},
        context: { ...run.context, messages },
      });
      expect(run.execute).toHaveBeenCalledTimes(1);
    },
  );

  it("does not execute a reconciliation that never admitted this run", async () => {
    const run = setup();
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    const rejected = prepareOwnerRecoveryAdmission({
      requestId: "unknown-owner",
      entry: "subagent-orphan",
      owner: {
        kind: "subagent-run",
        ownerId: identity.runId,
        runId: identity.runId,
        sessionKey: identity.sessionKey,
      },
      admission: {
        trigger: "gateway-restart",
        requiredPreState: "active-subagent-run",
        admitted: true,
        visibleOutputObserved: false,
      },
      budget: {
        attempts: { current: 1, max: 2 },
        backoff: { initialMs: 5000, multiplier: 2 },
        wedge: { afterAttempts: 2, wedged: false },
      },
      replayClass: "reconcile",
      effect: "unknown",
      requestedAction: "resume",
      idempotencyKey: "recovery-run",
      evidence: [],
      requestedAt: Date.now(),
    });
    expect(rejected.admitted).toBe(false);
    await redispatchAdmittedSessionTools({
      ...identity,
      ...run,
      runId: "recovery-run",
      config: {},
      entry: {
        sessionId: identity.sessionId,
        updatedAt: 1,
        subagentRecovery: { authority: rejected.record },
      },
    });
    expect(run.execute).not.toHaveBeenCalled();
  });

  it("rejects a different runner identity before executing an admitted subagent call", async () => {
    const run = setup();
    recordAssistantToolDispatches(assistant, identity);
    authorizePendingToolRecovery({ ...identity, messages: run.context.messages });
    const before = run.context.messages;
    const messages = await redispatchAdmittedSessionTools({
      ...identity,
      ...run,
      entry: { sessionId: "other-generation", updatedAt: Date.now() },
      runId: "other-run",
      config: {},
    });
    expect(messages).toBe(before);
    expect(run.execute).not.toHaveBeenCalled();
  });

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
