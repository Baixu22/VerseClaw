// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessage } from "../../openclaw_runtime/src/agents/runtime/index";
import type { ToolResultMessage } from "../../openclaw_runtime/src/llm/types";
import { pruneContextMessages } from "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner";
import { DEFAULT_CONTEXT_PRUNING_SETTINGS } from "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/settings";
import { createContextArchiveRecallTool } from "../../openclaw_runtime/src/agents/tools/context-agent-tools";
import { createContextArchiveHandleForPayloadSync } from "../../openclaw_runtime/src/context-engine/registry/context-item-registry";
import {
  ARCHIVE_RECALL_RETENTION_MAX_CHARS,
  ARCHIVE_RECALL_RETENTION_TURNS,
  getRetainedArchiveRecalls,
  preserveArchiveRecallOriginAfterIdRewrite,
} from "../../openclaw_runtime/src/agents/archive-recall-retention";
import {
  estimateToolResultReductionPotential,
  getToolResultTextLength,
  truncateOversizedToolResultsInMessages,
  truncateOversizedToolResultsInSessionManager,
} from "../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation";
import { shouldPreemptivelyCompactBeforePrompt } from "../../openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction";
import { OpenClawSchema } from "../../openclaw_runtime/src/config/zod-schema";
import { SessionManager } from "../../openclaw_runtime/src/agents/sessions/session-manager";
import { installSessionToolResultGuard } from "../../openclaw_runtime/src/agents/session-tool-result-guard";
import { convertToLlm } from "../../openclaw_runtime/src/agents/sessions/messages";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../../openclaw_runtime/src/agents/tool-call-id";
import {
  downgradeOpenAIFunctionCallReasoningPairs,
  normalizeOpenAIResponsesToolCallIds,
} from "../../openclaw_runtime/src/agents/embedded-agent-helpers/openai";
import {
  installProviderPromptHistoryTransform,
  normalizeMessagesForCurrentPromptBoundary,
  normalizeMessagesForLlmBoundary,
} from "../../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.llm-boundary";

const roots: string[] = [];
const sessionId = "session-inline-spill-retention";
const needle = "recalled-evidence-value-7391";
let archiveRoot: string;

beforeEach(() => {
  archiveRoot = mkdtempSync(join(tmpdir(), "inline-spill-retention-"));
  roots.push(archiveRoot);
  vi.stubEnv("OPENCLAW_CONTEXT_ARCHIVE_DIR", archiveRoot);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function recalledMessage(
  archiveRecallRetention = false,
  toolCallId = "recall-call",
): Promise<ToolResultMessage> {
  const payload = `head\n${"x".repeat(2_000)}\nprivate_evidence=${needle}\n${"y".repeat(2_000)}\ntail`;
  const handle = createContextArchiveHandleForPayloadSync({
    sessionId,
    itemId: (toolCallId === "recall-call"
      ? "inline-spill-retention-observation"
      : `inline-spill-retention-${toolCallId}`) as never,
    payload,
    archiveRoot,
    source: { type: "tool_call", sessionId, label: "retention-reproduction" },
  });
  const tool = createContextArchiveRecallTool({ sessionId, archiveRecallRetention });
  const result = await tool!.execute(toolCallId, {
    archive_uri: handle.uri,
    checksum: handle.checksum,
    byte_length: handle.byteLength,
    max_chars: 5_000,
  });
  return {
    role: "toolResult",
    toolName: "context_archive_recall",
    toolCallId,
    content: result.content,
    details: result.details,
    isError: false,
    timestamp: 2,
  };
}

function underPressure(recall: AgentMessage): AgentMessage[] {
  return [
    { role: "user", content: "Read the private evidence.", timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "recall-call", name: "context_archive_recall", arguments: {} },
      ],
      timestamp: 1,
    },
    recall,
    { role: "assistant", content: [{ type: "text", text: "Evidence read." }], timestamp: 3 },
    { role: "user", content: `Continue under pressure. ${"z".repeat(40_000)}`, timestamp: 4 },
    { role: "assistant", content: [{ type: "text", text: "Continue." }], timestamp: 5 },
    { role: "user", content: "Continue.", timestamp: 6 },
    { role: "assistant", content: [{ type: "text", text: "Continue." }], timestamp: 7 },
    { role: "user", content: "Use the recalled private evidence.", timestamp: 8 },
  ] as AgentMessage[];
}

function prune(messages: AgentMessage[], enabled = false): AgentMessage[] {
  return pruneContextMessages({
    messages,
    settings: structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
    ctx: { model: { contextWindow: 32_000 } } as never,
    isToolPrunable: () => true,
    archiveRecallRetention: { enabled, sessionId },
  });
}

function visibleText(messages: AgentMessage[]): string {
  return messages
    .map((message) => {
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return (content as unknown[])
        .flatMap((block) => {
          if (!block || typeof block !== "object") return [];
          const part = block as { type?: unknown; text?: unknown };
          return part.type === "text" && typeof part.text === "string" ? [part.text] : [];
        })
        .join("\n");
    })
    .join("\n");
}

describe("Inline/Spill archive recall retention", () => {
  it("reproduces page-in followed by eviction through the real pruner without retention", async () => {
    const messages = underPressure(await recalledMessage());
    const before = JSON.stringify(messages);
    const after = prune(messages);
    expect(visibleText(messages)).toContain(needle);
    expect(visibleText(after)).not.toContain(needle);
    expect(visibleText([after[2]!])).toContain("[Tool result trimmed:");
    expect(JSON.stringify(messages)).toBe(before);
    const evidencePath = process.env.CONTEXT_INLINE_SPILL_REPRO_OUT;
    if (evidencePath) {
      writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            schema: "ContextInlineSpillRetentionReproduction/v1",
            driven_by: "agent",
            actor: "codex-inline-spill-retention",
            path: "context_archive_recall -> ToolResultMessage -> pruneContextMessages",
            settings: DEFAULT_CONTEXT_PRUNING_SETTINGS,
            contextWindowTokens: 32_000,
            needlePresentBefore: visibleText(messages).includes(needle),
            needlePresentAfter: visibleText(after).includes(needle),
            inputUnchanged: JSON.stringify(messages) === before,
            before: messages,
            after,
          },
          null,
          2,
        ) + "\n",
      );
    }
  });

  it("retains the verified text at age three, then returns to the original pruner at age four", async () => {
    const recall = await recalledMessage(true);
    const messages = underPressure(recall);
    const retained = getRetainedArchiveRecalls(messages, { enabled: true, sessionId });
    expect(retained).toEqual([expect.objectContaining({ index: 2, ageTurns: 3, recalledTurn: 1 })]);
    expect(prune(messages, true)).toBe(messages);
    expect(visibleText(prune(messages, false))).not.toContain(needle);
    const expired = [
      ...messages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Next turn." }],
        timestamp: 9,
      },
    ] as AgentMessage[];
    expect(getRetainedArchiveRecalls(expired, { enabled: true, sessionId })).toEqual([]);
    expect(JSON.stringify(prune(expired, true))).toBe(JSON.stringify(prune(expired, false)));
    expect(visibleText(prune(expired, true))).not.toContain(needle);
    expect(ARCHIVE_RECALL_RETENTION_TURNS).toBe(4);
  });

  it("keeps ordinary tools prunable while preserving user text and assistant reasoning", async () => {
    const recall = await recalledMessage(true);
    const messages = underPressure(recall);
    const ordinary = { ...recall, toolName: "exec", toolCallId: "ordinary-call" } as AgentMessage;
    messages.splice(3, 0, ordinary);
    const reasoning = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "ordinary reasoning", thinkingSignature: "signature" },
      ],
      timestamp: 1,
    } as AgentMessage;
    messages.unshift(reasoning);
    const after = prune(messages, true);
    expect(after).not.toBe(messages);
    expect(after[messages.indexOf(recall)]).toBe(recall);
    expect(visibleText([after[messages.indexOf(ordinary)]!])).not.toContain(needle);
    for (let index = 0; index < messages.length; index++) {
      if (messages[index]?.role !== "toolResult") expect(after[index]).toBe(messages[index]);
    }
    expect(after[0]).toBe(reasoning);
  });

  it.each([
    "missing-origin",
    "foreign-session",
    "wrong-tool",
    "wrong-call",
    "wrong-checksum",
    "already-trimmed",
    "missing-content",
    "null-block",
  ])("fails closed on ineligible recall provenance: %s", async (failure) => {
    const recall = await recalledMessage(true);
    const message = structuredClone(recall);
    const details =
      message.role === "toolResult" ? (message.details as Record<string, unknown>) : {};
    const origin = details.archiveRecallOrigin as Record<string, unknown>;
    if (failure === "missing-origin") delete details.archiveRecallOrigin;
    if (failure === "foreign-session") origin.sessionId = "other-session";
    if (failure === "wrong-tool" && message.role === "toolResult") message.toolName = "exec";
    if (failure === "wrong-call") origin.toolCallId = "other-call";
    if (failure === "wrong-checksum") origin.checksum = `sha256:${"a".repeat(64)}`;
    if (failure === "already-trimmed")
      message.content = [{ type: "text", text: "[already trimmed]" }];
    if (failure === "missing-content") message.content = undefined as never;
    if (failure === "null-block") message.content = [null] as never;
    expect(getRetainedArchiveRecalls(underPressure(message), { enabled: true, sessionId })).toEqual(
      [],
    );
  });

  it("does not issue provenance for checksum failure, missing archive, or a foreign session", async () => {
    const message = await recalledMessage(true);
    const details =
      message.role === "toolResult" ? (message.details as Record<string, unknown>) : {};
    const args = { archive_uri: details.archive_uri, checksum: details.checksum, max_chars: 100 };
    const current = createContextArchiveRecallTool({ sessionId, archiveRecallRetention: true })!;
    const foreign = createContextArchiveRecallTool({
      sessionId: "other-session",
      archiveRecallRetention: true,
    })!;
    const outcomes = [
      await current.execute("checksum-negative", { ...args, checksum: `sha256:${"a".repeat(64)}` }),
      await foreign.execute("scope-negative", args),
      await current.execute("missing-negative", {
        ...args,
        archive_uri: `context-archive://${sessionId}/missing.context-archive.json`,
      }),
    ];
    for (const result of outcomes) {
      const payload = result.details as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.archiveRecallOrigin).toBeUndefined();
      expect(JSON.stringify(result.content)).not.toContain(needle);
    }
  });

  it("bounds all retained text and protects only the newest duplicate archive page", async () => {
    const recalls = await Promise.all(
      Array.from({ length: 5 }, (_, index) => recalledMessage(true, `cap-${index}`)),
    );
    const retained = getRetainedArchiveRecalls(recalls, { enabled: true, sessionId });
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThan(recalls.length);
    expect(retained.reduce((sum, item) => sum + item.chars, 0)).toBeLessThanOrEqual(
      ARCHIVE_RECALL_RETENTION_MAX_CHARS,
    );
    const samePage = [recalls[0]!, structuredClone(recalls[0]!)];
    expect(
      getRetainedArchiveRecalls(samePage, { enabled: true, sessionId }).map((item) => item.index),
    ).toEqual([1]);
    expect(getRetainedArchiveRecalls(recalls, { enabled: true, sessionId, maxChars: 100 })).toEqual(
      [],
    );
  });

  it("does not protect an older page when the newest verified recall exceeds the cap", async () => {
    const newest = await recalledMessage(true);
    const details = newest.details as Record<string, unknown>;
    const result = await createContextArchiveRecallTool({
      sessionId,
      archiveRecallRetention: true,
    })!.execute("older-page", {
      archive_uri: details.archive_uri,
      checksum: details.checksum,
      max_chars: 1_000,
    });
    const older = {
      ...newest,
      toolCallId: "older-page",
      content: result.content,
      details: result.details,
    };
    expect(
      getRetainedArchiveRecalls([older], { enabled: true, sessionId, maxChars: 2_000 }),
    ).toHaveLength(1);
    expect(
      getRetainedArchiveRecalls([older, newest], {
        enabled: true,
        sessionId,
        maxChars: 2_000,
      }),
    ).toEqual([]);
    const trimmedNewest = { ...newest, content: [{ type: "text" as const, text: "[trimmed]" }] };
    expect(getRetainedArchiveRecalls([older, trimmedNewest], { enabled: true, sessionId })).toEqual(
      [],
    );
  });

  it("preserves verified provenance through internal session replay", async () => {
    const { sanitizeSessionHistory } =
      await import("../../openclaw_runtime/src/agents/embedded-agent-runner/replay-history");
    const messages = underPressure(await recalledMessage(true));
    const sanitized = await sanitizeSessionHistory({
      messages,
      modelApi: "openai-responses",
      sessionId,
      sessionManager: SessionManager.inMemory(),
      config: { runtime: { contextFamily: { archiveRecallRetention: { enabled: true } } } },
    });
    expect(getRetainedArchiveRecalls(sanitized, { enabled: true, sessionId })).toEqual([
      expect.objectContaining({ index: 2, ageTurns: 3 }),
    ]);
    expect(visibleText(prune(sanitized, true))).toContain(needle);
    const internal = normalizeMessagesForCurrentPromptBoundary({
      messages: sanitized,
      prompt: "Use the recalled evidence.",
      archiveRecallRetention: { enabled: true, sessionId },
    });
    expect(getRetainedArchiveRecalls(internal, { enabled: true, sessionId })).toEqual([
      expect.objectContaining({ index: 2, ageTurns: 3 }),
    ]);
    const provider = normalizeMessagesForLlmBoundary(internal);
    expect(provider.every((message) => !("details" in message))).toBe(true);
    expect(visibleText(provider)).toContain(needle);
  });

  it.each(["ascii", "cjk"])(
    "keeps lineage through guarded disk persistence for large %s pages",
    async (kind) => {
      const manager = SessionManager.create(archiveRoot, join(archiveRoot, "sessions"));
      const diskSessionId = manager.getSessionId();
      const padding = kind === "ascii" ? "x".repeat(5_000) : "界".repeat(2_500);
      const payload = `head\n${padding}\nprivate_evidence=${needle}\n${padding}\ntail`;
      expect(Buffer.byteLength(payload)).toBeGreaterThan(8_192);
      const handle = createContextArchiveHandleForPayloadSync({
        sessionId: diskSessionId,
        itemId: "persisted-recall" as never,
        payload,
        archiveRoot,
        source: { type: "tool_call", sessionId: diskSessionId, label: "guarded-disk-recall" },
      });
      const result = await createContextArchiveRecallTool({
        sessionId: diskSessionId,
        archiveRecallRetention: true,
      })!.execute("recall-call", {
        archive_uri: handle.uri,
        checksum: handle.checksum,
        byte_length: handle.byteLength,
        max_chars: 12_000,
      });
      const recall = {
        role: "toolResult",
        toolName: "context_archive_recall",
        toolCallId: "recall-call",
        ...result,
        isError: false,
        timestamp: 2,
      } as AgentMessage;
      expect(Buffer.byteLength(JSON.stringify(result.details))).toBeLessThan(8_192);
      installSessionToolResultGuard(manager);
      for (const message of underPressure(recall)) manager.appendMessage(message as never);
      const file = manager.getSessionFile()!;
      expect(readFileSync(file, "utf8")).toContain(needle);
      const reopened = SessionManager.open(file);
      const restored = reopened
        .getBranch()
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.message) as AgentMessage[];
      expect(
        getRetainedArchiveRecalls(restored, { enabled: true, sessionId: diskSessionId }),
      ).toEqual([expect.objectContaining({ index: 2, ageTurns: 3 })]);
      const after = pruneContextMessages({
        messages: restored,
        settings: structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
        ctx: { model: { contextWindow: 32_000 } } as never,
        archiveRecallRetention: { enabled: true, sessionId: diskSessionId },
      });
      expect(visibleText(after)).toContain(needle);
    },
  );

  it.each([false, true])(
    "uses the production provider transform before details stripping: enabled=%s",
    async (enabled) => {
      const recall = await recalledMessage(true);
      const messages = [
        recall,
        {
          role: "toolResult",
          toolName: "exec",
          toolCallId: "provider-ordinary",
          timestamp: 3,
          content: [{ type: "text", text: "o".repeat(4_000) }],
        },
      ] as AgentMessage[];
      const baseConvert = (messages: AgentMessage[]) =>
        convertToLlm(normalizeMessagesForLlmBoundary(messages));
      const observed: AgentMessage[][] = [];
      const baseStream: Parameters<
        typeof installProviderPromptHistoryTransform
      >[0]["agent"]["streamFn"] = (_model, context) => {
        observed.push(context.messages as AgentMessage[]);
        return {} as never;
      };
      const agent = { convertToLlm: baseConvert, streamFn: baseStream };
      const cleanup = installProviderPromptHistoryTransform({
        agent,
        contextWindowTokens: 32_000,
        maxChars: 6_000,
        aggregateMaxChars: 6_000,
        archiveRecallRetention: { enabled, sessionId },
      });
      const converted = await agent.convertToLlm(messages);
      agent.streamFn({} as never, { messages: converted, systemPrompt: "" });
      const provider = observed[0]!;
      expect(visibleText(provider).includes(needle)).toBe(enabled);
      expect(provider.every((message) => !("details" in message))).toBe(true);
      expect(
        provider.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
      ).toBeLessThanOrEqual(6_000);
      expect(visibleText([messages[0]!])).toContain(needle);
      cleanup();
      expect(agent.convertToLlm).toBe(baseConvert);
      expect(agent.streamFn).toBe(baseStream);
    },
  );

  it("rejects incomplete call-id lineage instead of repairing it into a valid binding", async () => {
    const original = await recalledMessage(true);
    expect(getRetainedArchiveRecalls([original], { enabled: true, sessionId })).toHaveLength(1);
    for (const toolCallId of [undefined, "", "   "]) {
      const malformed = structuredClone(original);
      Object.assign(malformed, { toolCallId });
      const details = malformed.details as Record<string, unknown>;
      Object.assign(details.archiveRecallOrigin as Record<string, unknown>, { toolCallId });
      expect(getRetainedArchiveRecalls([malformed], { enabled: true, sessionId })).toEqual([]);
      const rewritten = preserveArchiveRecallOriginAfterIdRewrite(malformed, {
        ...malformed,
        toolCallId: "rewritten-valid-call",
      });
      expect((rewritten.details as Record<string, unknown>).archiveRecallOrigin).toBeUndefined();
    }
  });

  it("rejects missing, negative, fractional and unsafe archive page offsets", async () => {
    const original = await recalledMessage(true);
    for (const offset of [undefined, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = structuredClone(original);
      const details = malformed.details as Record<string, unknown>;
      details.offset = offset;
      (details.archiveRecallOrigin as Record<string, unknown>).offset = offset;
      expect(getRetainedArchiveRecalls([malformed], { enabled: true, sessionId })).toEqual([]);
    }
  });

  it.each(["strict", "strict9", "openai-responses"] as const)(
    "keeps only verified lineage across the existing call-id rewrite: %s",
    async (mode) => {
      const source = underPressure(await recalledMessage(true));
      const normalize = (messages: AgentMessage[]) =>
        mode === "openai-responses"
          ? normalizeOpenAIResponsesToolCallIds(messages)
          : sanitizeToolCallIdsForCloudCodeAssist(messages, mode);
      const normalized = normalize(source);
      const result = normalized[2] as ToolResultMessage;
      expect(result.toolCallId).not.toBe("recall-call");
      expect(getRetainedArchiveRecalls(normalized, { enabled: true, sessionId })).toEqual([
        expect.objectContaining({ index: 2, toolCallId: result.toolCallId }),
      ]);
      const forged = structuredClone(source);
      const details = (forged[2] as ToolResultMessage).details as {
        archiveRecallOrigin: { toolCallId: string };
      };
      details.archiveRecallOrigin.toolCallId = result.toolCallId;
      expect(getRetainedArchiveRecalls(normalize(forged), { enabled: true, sessionId })).toEqual(
        [],
      );
    },
  );

  it("carries verified lineage when a replay drops an unpaired function-call item id", async () => {
    const original = await recalledMessage(true);
    const details = original.details as Record<string, unknown>;
    const callId = "call_recall|fc_recall";
    const result = await createContextArchiveRecallTool({
      sessionId,
      archiveRecallRetention: true,
    })!.execute(callId, {
      archive_uri: details.archive_uri,
      checksum: details.checksum,
      max_chars: 5_000,
    });
    const source = underPressure({ ...original, ...result, toolCallId: callId });
    source[1] = {
      ...source[1],
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name: "context_archive_recall", arguments: {} }],
    } as AgentMessage;
    const normalized = downgradeOpenAIFunctionCallReasoningPairs(source);
    expect((normalized[2] as ToolResultMessage).toolCallId).toBe("call_recall");
    expect(getRetainedArchiveRecalls(normalized, { enabled: true, sessionId })).toEqual([
      expect.objectContaining({ index: 2, toolCallId: "call_recall" }),
    ]);
  });

  it("does not refresh the window or inject messages on repeated projection", async () => {
    const messages = underPressure(await recalledMessage(true));
    const before = JSON.stringify(messages);
    for (let iteration = 0; iteration < 1_000; iteration++) {
      expect(prune(messages, true)).toBe(messages);
      expect(getRetainedArchiveRecalls(messages, { enabled: true, sessionId })[0]?.ageTurns).toBe(
        3,
      );
    }
    expect(JSON.stringify(messages)).toBe(before);
    expect(messages).toHaveLength(9);
  });

  it("also excludes the retained result from hard-clear candidates", async () => {
    const messages = underPressure(await recalledMessage(true));
    const options = {
      messages,
      settings: {
        ...structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
        keepLastAssistants: 0,
        hardClearRatio: 0,
        minPrunableToolChars: 0,
      },
      ctx: { model: { contextWindow: 32_000 } } as never,
      isToolPrunable: () => true,
    };
    const off = pruneContextMessages({
      ...options,
      archiveRecallRetention: { enabled: false, sessionId },
    });
    const on = pruneContextMessages({
      ...options,
      archiveRecallRetention: { enabled: true, sessionId },
    });
    expect(visibleText([off[2]!])).toBe(DEFAULT_CONTEXT_PRUNING_SETTINGS.hardClear.placeholder);
    expect(on[2]).toBe(messages[2]);
  });

  it("wires the session-scoped extension flag into both pruning and its would-trim report", async () => {
    const { default: extension } =
      await import("../../openclaw_runtime/src/agents/agent-hooks/context-pruning/extension");
    const { setContextPruningRuntime } =
      await import("../../openclaw_runtime/src/agents/agent-hooks/context-pruning/runtime");
    const messages = underPressure(await recalledMessage(true));
    const sessionManager = SessionManager.inMemory();
    const runtime: Parameters<typeof setContextPruningRuntime>[1] = {
      settings: structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
      sessionId,
      archiveRecallRetention: true,
      contextWindowTokens: 32_000,
      dropThinkingBlocks: false,
      isToolPrunable: () => true,
      wouldTrimShadow: true,
      lastCacheTouchAt: Date.now() - DEFAULT_CONTEXT_PRUNING_SETTINGS.ttlMs - 1,
    };
    setContextPruningRuntime(sessionManager, runtime);
    let handler: ((event: { messages: AgentMessage[] }, ctx: unknown) => unknown) | undefined;
    extension({
      on: (_event: string, callback: typeof handler) => {
        handler = callback;
      },
    } as never);
    expect(
      handler!({ messages }, { sessionManager, model: { contextWindow: 32_000 } }),
    ).toBeUndefined();
    expect(runtime.lastWouldTrim?.wouldTrim).toBe(false);
    runtime.archiveRecallRetention = false;
    const off = handler!({ messages }, { sessionManager, model: { contextWindow: 32_000 } }) as {
      messages: AgentMessage[];
    };
    expect(visibleText(off.messages)).not.toContain(needle);
    expect(runtime.lastWouldTrim?.wouldTrim).toBe(true);
  });

  it("uses the same protection for aggregate truncation without exceeding its existing budget", async () => {
    const recall = await recalledMessage(true);
    const ordinary = {
      role: "toolResult",
      toolName: "exec",
      toolCallId: "budget-ordinary",
      timestamp: 3,
      content: [{ type: "text", text: "o".repeat(4_000) }],
    } as AgentMessage;
    const messages = [recall, ordinary];
    const on = truncateOversizedToolResultsInMessages(messages, 32_000, 6_000, 6_000, {
      sessionId,
      archiveRecallRetention: true,
    });
    const off = truncateOversizedToolResultsInMessages(messages, 32_000, 6_000, 6_000, {
      sessionId,
      archiveRecallRetention: false,
    });
    expect(on.messages[0]).toBe(recall);
    expect(off.messages[0]).not.toBe(recall);
    expect(on.messages[1]).not.toBe(ordinary);
    expect(
      on.messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
    ).toBeLessThanOrEqual(6_000);
    const tooSmall = truncateOversizedToolResultsInMessages(messages, 32_000, 1_000, 1_500, {
      sessionId,
      archiveRecallRetention: true,
    });
    expect(tooSmall.messages[0]).not.toBe(recall);
    expect(tooSmall.messages.every((message) => getToolResultTextLength(message) <= 1_000)).toBe(
      true,
    );
    expect(
      tooSmall.messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
    ).toBeLessThanOrEqual(1_500);
  });

  it("protects multiple fitting recalls under separate single and aggregate limits", async () => {
    const recalls = [
      await recalledMessage(true, "retained-a"),
      await recalledMessage(true, "retained-b"),
    ];
    const ordinary = Array.from({ length: 3 }, (_, index) => ({
      role: "toolResult",
      toolName: "exec",
      toolCallId: `ordinary-${index}`,
      timestamp: 3,
      content: [{ type: "text", text: "o".repeat(6_000) }],
    })) as AgentMessage[];
    const messages = [...recalls, ...ordinary];
    expect(
      recalls.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
    ).toBeGreaterThan(6_000);
    const output = truncateOversizedToolResultsInMessages(messages, 32_000, 6_000, 24_000, {
      sessionId,
      archiveRecallRetention: true,
    });
    expect(output.messages[0]).toBe(recalls[0]);
    expect(output.messages[1]).toBe(recalls[1]);
    expect(
      output.messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
    ).toBeLessThanOrEqual(24_000);
    expect(
      getRetainedArchiveRecalls(messages, {
        enabled: true,
        sessionId,
        maxChars: 16_000,
        maxResultChars: 6_000,
      }),
    ).toHaveLength(2);
  });

  it("does not reserve truncation notices for recalls that remain intact", async () => {
    const recalls = [
      await recalledMessage(true, "tight-a"),
      await recalledMessage(true, "tight-b"),
    ];
    const ordinary = {
      role: "toolResult",
      toolName: "exec",
      toolCallId: "tight-ordinary",
      timestamp: 3,
      content: [{ type: "text", text: "o".repeat(6_000) }],
    } as AgentMessage;
    const budget =
      recalls.reduce((sum, message) => sum + getToolResultTextLength(message), 0) + 200;
    const output = truncateOversizedToolResultsInMessages(
      [...recalls, ordinary],
      32_000,
      6_000,
      budget,
      { sessionId, archiveRecallRetention: true },
    );
    expect(output.messages[0]).toBe(recalls[0]);
    expect(output.messages[1]).toBe(recalls[1]);
    expect(
      output.messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
    ).toBeLessThanOrEqual(budget);
  });

  it.each([false, true])(
    "enforces the final size after a converter adds visible text: enabled=%s",
    async (enabled) => {
      const input = [
        {
          role: "toolResult",
          toolName: "read",
          toolCallId: "blocked-image",
          timestamp: 1,
          content: [{ type: "text", text: "x".repeat(16_000) }],
        },
      ] as AgentMessage[];
      // sdk.ts's convertToLlmWithBlockImages adds this text after normalization.
      // Exercise the converter contract without loading the full session bootstrap.
      const baseConvert = (messages: AgentMessage[]) =>
        convertToLlm(normalizeMessagesForLlmBoundary(messages)).map((message) =>
          message.role === "toolResult"
            ? {
                ...message,
                content: [
                  ...message.content,
                  { type: "text" as const, text: "Image reading is disabled." },
                ],
              }
            : message,
        );
      const observed: AgentMessage[][] = [];
      const agent: Parameters<typeof installProviderPromptHistoryTransform>[0]["agent"] = {
        convertToLlm: baseConvert,
        streamFn: (_model, context) => {
          observed.push(context.messages as AgentMessage[]);
          return {} as never;
        },
      };
      const cleanup = installProviderPromptHistoryTransform({
        agent,
        contextWindowTokens: 64_000,
        maxChars: 16_000,
        aggregateMaxChars: 64_000,
        archiveRecallRetention: { enabled, sessionId },
      });
      const converted = await agent.convertToLlm(input);
      agent.streamFn({} as never, { messages: converted, systemPrompt: "" });
      expect(getToolResultTextLength(observed[0]![0]!)).toBeLessThanOrEqual(16_000);
      expect(observed[0]!.every((message) => !("details" in message))).toBe(true);
      cleanup();
    },
  );

  it("does not reattach lineage to a recall whose converter changed the projection", async () => {
    const recall = await recalledMessage(true);
    const ordinary = {
      role: "toolResult",
      toolName: "exec",
      toolCallId: "ordinary",
      timestamp: 3,
      content: [{ type: "text", text: "o".repeat(4_000) }],
    } as AgentMessage;
    const agent: Parameters<typeof installProviderPromptHistoryTransform>[0]["agent"] = {
      convertToLlm: (messages) =>
        convertToLlm(messages).map((message) =>
          message.role === "toolResult" && message.toolName === "context_archive_recall"
            ? {
                ...message,
                content: [
                  {
                    type: "text" as const,
                    text: "changed" + "x".repeat(getToolResultTextLength(message) - 7),
                  },
                ],
              }
            : message,
        ),
      streamFn: () => ({}) as never,
    };
    const cleanup = installProviderPromptHistoryTransform({
      agent,
      contextWindowTokens: 32_000,
      maxChars: 6_000,
      aggregateMaxChars: 6_000,
      archiveRecallRetention: { enabled: true, sessionId },
    });
    const converted = await agent.convertToLlm([recall, ordinary]);
    expect(getToolResultTextLength(converted[0]!)).toBeLessThan(getToolResultTextLength(recall));
    expect(converted.every((message) => !("details" in message))).toBe(true);
    cleanup();
  });

  it("converts an observation-masking replacement before dispatch and keeps its lineage internal", async () => {
    const overlay = normalizeMessagesForCurrentPromptBoundary({
      messages: underPressure(await recalledMessage(true)),
      prompt: "Use the evidence.",
      archiveRecallRetention: { enabled: true, sessionId },
    });
    expect(overlay.some((message) => "details" in message)).toBe(true);
    const conversionInputs: AgentMessage[][] = [];
    const observed: AgentMessage[][] = [];
    const agent: Parameters<typeof installProviderPromptHistoryTransform>[0]["agent"] = {
      convertToLlm: (messages) => {
        conversionInputs.push(messages);
        return convertToLlm(normalizeMessagesForLlmBoundary(messages));
      },
      streamFn: (_model, context) => {
        observed.push(context.messages as AgentMessage[]);
        return {} as never;
      },
    };
    const cleanup = installProviderPromptHistoryTransform({
      agent,
      contextWindowTokens: 32_000,
      maxChars: 6_000,
      aggregateMaxChars: 24_000,
      archiveRecallRetention: { enabled: true, sessionId },
      observationMaskingMessages: overlay,
    });
    const converted = await agent.convertToLlm([
      { role: "user", content: "Original history.", timestamp: 1 },
    ]);
    agent.streamFn({} as never, { messages: converted, systemPrompt: "" });
    expect(conversionInputs[0]).toBe(overlay);
    expect(visibleText(observed[0]!)).toContain(needle);
    expect(observed[0]!.every((message) => !("details" in message))).toBe(true);
    cleanup();
  });

  it("uses the legacy plan when multi-block notice floors leave insufficient aggregate budget", async () => {
    const recall = await recalledMessage(true);
    const ordinary = {
      role: "toolResult",
      toolName: "exec",
      toolCallId: "multi-block-budget",
      timestamp: 3,
      content: Array.from({ length: 4 }, () => ({ type: "text", text: "o".repeat(1_000) })),
    } as AgentMessage;
    const messages = [recall, ordinary];
    const budget = getToolResultTextLength(recall) + 200;
    for (const enabled of [false, true]) {
      const output = truncateOversizedToolResultsInMessages(messages, 32_000, 6_000, budget, {
        sessionId,
        archiveRecallRetention: enabled,
      });
      expect(
        output.messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0),
      ).toBeLessThanOrEqual(budget);
      expect(output.messages[0]).not.toBe(recall);
    }
  });

  it("preserves the same recall in transcript replacement and does not claim protected text is reducible", async () => {
    const recall = await recalledMessage(true);
    const messages = [
      recall,
      {
        role: "toolResult",
        toolName: "exec",
        toolCallId: "session-ordinary",
        timestamp: 3,
        content: [{ type: "text", text: "o".repeat(4_000) }],
      },
    ] as AgentMessage[];
    const manager = SessionManager.inMemory();
    for (const message of messages)
      manager.appendMessage(message as Parameters<typeof manager.appendMessage>[0]);
    const result = truncateOversizedToolResultsInSessionManager({
      sessionManager: manager,
      contextWindowTokens: 32_000,
      maxCharsOverride: 6_000,
      aggregateMaxCharsOverride: 6_000,
      sessionId,
      archiveRecallRetention: true,
    });
    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBe(1);
    const activeMessages = manager
      .getBranch()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message);
    expect(activeMessages).toHaveLength(2);
    expect(visibleText([activeMessages[0]!])).toBe(visibleText([recall]));
    const estimate = estimateToolResultReductionPotential({
      messages,
      contextWindowTokens: 32_000,
      maxCharsOverride: 6_000,
      aggregateMaxCharsOverride: 6_000,
      archiveRecallRetention: { enabled: true, sessionId },
    });
    const projected = truncateOversizedToolResultsInMessages(messages, 32_000, 6_000, 6_000, {
      sessionId,
      archiveRecallRetention: true,
    });
    const saved =
      messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0) -
      projected.messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0);
    expect(estimate.maxReducibleChars).toBe(saved);
  });

  it("keeps the flag off by default and exactly replays the frozen pre-implementation tool/pruning/compaction outputs", async () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL(
          "../../harness/specs/fixtures/context-inline-spill/off-mode-baseline.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      toolResult: AgentMessage;
      pruner: { input: Parameters<typeof pruneContextMessages>[0]; output: AgentMessage[] };
      truncation: {
        input: Parameters<typeof estimateToolResultReductionPotential>[0];
        output: ReturnType<typeof truncateOversizedToolResultsInMessages>;
      };
      reduction: {
        input: Parameters<typeof estimateToolResultReductionPotential>[0];
        output: ReturnType<typeof estimateToolResultReductionPotential>;
      };
      compaction: {
        input: Parameters<typeof shouldPreemptivelyCompactBeforePrompt>[0];
        output: ReturnType<typeof shouldPreemptivelyCompactBeforePrompt>;
      };
    };
    expect(JSON.stringify(await recalledMessage(false))).toBe(JSON.stringify(baseline.toolResult));
    expect(
      JSON.stringify(
        pruneContextMessages({
          ...baseline.pruner.input,
          archiveRecallRetention: { enabled: false, sessionId },
        }),
      ),
    ).toBe(JSON.stringify(baseline.pruner.output));
    const input = baseline.truncation.input;
    expect(
      JSON.stringify(
        truncateOversizedToolResultsInMessages(
          input.messages,
          input.contextWindowTokens,
          input.maxCharsOverride,
          input.aggregateMaxCharsOverride,
          { archiveRecallRetention: false },
        ),
      ),
    ).toBe(JSON.stringify(baseline.truncation.output));
    expect(
      JSON.stringify(
        estimateToolResultReductionPotential({
          ...baseline.reduction.input,
          archiveRecallRetention: { enabled: false, sessionId },
        }),
      ),
    ).toBe(JSON.stringify(baseline.reduction.output));
    expect(
      JSON.stringify(
        shouldPreemptivelyCompactBeforePrompt({
          ...baseline.compaction.input,
          archiveRecallRetention: { enabled: false, sessionId },
        }),
      ),
    ).toBe(JSON.stringify(baseline.compaction.output));
    expect(OpenClawSchema.parse({}).runtime?.contextFamily?.archiveRecallRetention).toBeUndefined();
    expect(
      OpenClawSchema.safeParse({
        runtime: { contextFamily: { archiveRecallRetention: { enabled: true } } },
      }).success,
    ).toBe(true);
  });
});
