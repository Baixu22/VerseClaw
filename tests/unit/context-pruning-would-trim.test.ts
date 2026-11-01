// @vitest-environment node
/**
 * TF-0646 / A6: would-trim shadow evidence.
 *
 * The point of this leaf is that the report must not change what is sent: it
 * runs the real planner over a copy, reports counts, and leaves the input alone.
 */
import { describe, expect, it } from "vitest";

import type { AgentMessage } from "../../openclaw_runtime/src/agents/runtime/index";
import {
  DEFAULT_CONTEXT_PRUNING_SETTINGS,
  type EffectiveContextPruningSettings,
} from "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/settings";
import {
  WOULD_TRIM_REPORT_SCHEMA,
  buildWouldTrimReport,
  decideWouldTrimGate,
} from "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/would-trim";

const ctx = { model: { contextWindow: 1000 } } as never;

function toolResult(toolName: string, text: string, index: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${index}`,
    toolName,
    content: [{ type: "text", text }],
    timestamp: 1,
  } as AgentMessage;
}

function history(): AgentMessage[] {
  return [
    { role: "user", content: "start", timestamp: 1 } as AgentMessage,
    { role: "assistant", content: [{ type: "text", text: "one" }], timestamp: 2 } as AgentMessage,
    { role: "user", content: "go", timestamp: 3 } as AgentMessage,
    toolResult("exec", "a".repeat(30_000), 1),
    { role: "assistant", content: [{ type: "text", text: "two" }], timestamp: 5 } as AgentMessage,
    { role: "user", content: "go", timestamp: 6 } as AgentMessage,
    { role: "assistant", content: [{ type: "text", text: "three" }], timestamp: 7 } as AgentMessage,
    { role: "user", content: "go", timestamp: 8 } as AgentMessage,
    { role: "assistant", content: [{ type: "text", text: "four" }], timestamp: 9 } as AgentMessage,
    { role: "user", content: "go", timestamp: 10 } as AgentMessage,
    { role: "assistant", content: [{ type: "text", text: "five" }], timestamp: 11 } as AgentMessage,
  ];
}

function settings(overrides: Partial<EffectiveContextPruningSettings> = {}): EffectiveContextPruningSettings {
  return {
    ...structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
    mode: "cache-ttl",
    softTrimRatio: 0.01,
    hardClearRatio: 0.9,
    minPrunableToolChars: 100,
    keepLastAssistants: 3,
    softTrim: { maxChars: 400, headChars: 150, tailChars: 150 },
    ...overrides,
  };
}

describe("would-trim report", () => {
  it("reports what would change without mutating the input", () => {
    const messages = history();
    const snapshot = JSON.parse(JSON.stringify(messages)) as unknown;
    const report = buildWouldTrimReport({
      messages,
      settings: settings(),
      ctx,
      isToolPrunable: () => true,
      contextWindowTokensOverride: 1000,
    });
    expect(report.schema).toBe(WOULD_TRIM_REPORT_SCHEMA);
    expect(report.wouldTrim).toBe(true);
    expect(report.items.length).toBeGreaterThan(0);
    expect(report.charsSaved).toBeGreaterThan(0);
    expect(report.itemsAfter).toBe(report.itemsBefore);
    // The report must be evidence about a copy, not a mutation of the turn.
    expect(JSON.parse(JSON.stringify(messages))).toEqual(snapshot);
  });

  it("reports nothing when the planner would not trim", () => {
    const messages = history().slice(0, 3);
    const report = buildWouldTrimReport({
      messages,
      settings: settings(),
      ctx,
      isToolPrunable: () => true,
      contextWindowTokensOverride: 1000,
    });
    expect(report.wouldTrim).toBe(false);
    expect(report.items).toEqual([]);
    expect(report.charsSaved).toBe(0);
  });

  it("keeps every owner ref free of tool payload text", () => {
    const messages = history();
    const report = buildWouldTrimReport({
      messages,
      settings: settings(),
      ctx,
      isToolPrunable: () => true,
      contextWindowTokensOverride: 1000,
    });
    const refs = report.items.map((item) => item.ownerRef).join("\n");
    expect(refs).not.toContain("a".repeat(100));
    expect(refs).toMatch(/^msg:\d+:/m);
  });

  it("honours the tool whitelist: a denied tool yields no items", () => {
    const messages = history();
    const report = buildWouldTrimReport({
      messages,
      settings: settings(),
      ctx,
      isToolPrunable: () => false,
      contextWindowTokensOverride: 1000,
    });
    expect(report.wouldTrim).toBe(false);
    expect(report.items).toEqual([]);
  });

  it("keeps the last assistants: trimming only touches the older tool result", () => {
    const messages = history();
    const report = buildWouldTrimReport({
      messages,
      settings: settings({ keepLastAssistants: 2 }),
      ctx,
      isToolPrunable: () => true,
      contextWindowTokensOverride: 1000,
    });
    for (const item of report.items) {
      expect(item.index).toBe(3);
      expect(item.toolName).toBe("exec");
    }
  });
});

describe("extension shadow recording", () => {
  it("records the report when the flag is on and returns the same pruned messages", async () => {
    const { default: contextPruningExtension } = await import(
      "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/extension"
    );
    const { setContextPruningRuntime } = await import(
      "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/runtime"
    );
    const messages = history();
    const runtime = {
      settings: settings(),
      isToolPrunable: () => true,
      dropThinkingBlocks: false,
      contextWindowTokens: 1000,
      lastCacheTouchAt: 0,
      wouldTrimShadow: true,
    };
    type RuntimeWithReport = Parameters<typeof setContextPruningRuntime>[1] & { lastWouldTrim?: { schema: string; gate: { decision: string; reason: string } } };
    const sessionManager = {} as never;
    setContextPruningRuntime(sessionManager, runtime as RuntimeWithReport);
    let handler: ((event: { messages: AgentMessage[] }, ctx: unknown) => unknown) | undefined;
    const api = {
      on: (event: string, cb: (event: { messages: AgentMessage[] }, ctx: unknown) => unknown) => {
        if (event === "context") handler = cb;
      },
    };
    contextPruningExtension(api as never);
    expect(handler).toBeDefined();
    const result = handler!({ messages }, { sessionManager, model: { contextWindow: 1000 } });
    // Cache-TTL mode is age-gated; with no touch it legitimately does nothing,
    // but the shadow report is still the evidence this flag exists for.
    expect(result).toBeUndefined();
    const recorded = (runtime as RuntimeWithReport).lastWouldTrim;
    expect(recorded?.schema).toBe(WOULD_TRIM_REPORT_SCHEMA);
    expect(recorded?.gate.decision).toBe("go");
    expect(JSON.parse(JSON.stringify(messages))).toEqual(JSON.parse(JSON.stringify(history())));
  });

  it("does not record anything when the shadow flag is off", async () => {
    const { default: contextPruningExtension } = await import(
      "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/extension"
    );
    const { setContextPruningRuntime } = await import(
      "../../openclaw_runtime/src/agents/agent-hooks/context-pruning/runtime"
    );
    const runtime = {
      settings: settings(),
      isToolPrunable: () => true,
      dropThinkingBlocks: false,
      contextWindowTokens: 1000,
      lastCacheTouchAt: 0,
      wouldTrimShadow: false,
    };
    type RuntimeWithReport = Parameters<typeof setContextPruningRuntime>[1] & { lastWouldTrim?: { schema: string; gate: { decision: string; reason: string } } };
    const sessionManager = {} as never;
    setContextPruningRuntime(sessionManager, runtime as RuntimeWithReport);
    let handler: ((event: { messages: AgentMessage[] }, ctx: unknown) => unknown) | undefined;
    contextPruningExtension({
      on: (_event: string, cb: (event: { messages: AgentMessage[] }, ctx: unknown) => unknown) => {
        handler = cb;
      },
    } as never);
    handler!({ messages: history() }, { sessionManager, model: { contextWindow: 1000 } });
    expect((runtime as RuntimeWithReport).lastWouldTrim).toBeUndefined();
  });
});
describe("GO / NO-GO gate", () => {
  it("is NO-GO when nothing would trim", () => {
    expect(decideWouldTrimGate({
      schema: WOULD_TRIM_REPORT_SCHEMA,
      wouldTrim: false,
      items: [],
      itemsBefore: 1,
      itemsAfter: 1,
      charsBefore: 100,
      charsAfter: 100,
      charsSaved: 0,
      estimatedTokensSaved: 0,
      projectedDigest: "sha256:x",
    })).toEqual({ decision: "no-go", reason: "no-trim" });
  });

  it("is NO-GO when the saving is below 1%", () => {
    const gate = decideWouldTrimGate({
      schema: WOULD_TRIM_REPORT_SCHEMA,
      wouldTrim: true,
      items: [
        {
          ownerRef: "msg:3:exec:abc",
          index: 3,
          toolName: "exec",
          charsBefore: 100_000,
          charsAfter: 99_500,
          charsSaved: 500,
          action: "soft-trim",
        },
      ],
      itemsBefore: 10,
      itemsAfter: 10,
      charsBefore: 100_000,
      charsAfter: 99_500,
      charsSaved: 500,
      estimatedTokensSaved: 125,
      projectedDigest: "sha256:x",
    });
    expect(gate.decision).toBe("no-go");
    expect(gate.reason).toMatch(/saving-below-1pct/);
  });

  it("is GO only when there is a material saving", () => {
    const report = buildWouldTrimReport({
      messages: history(),
      settings: settings(),
      ctx,
      isToolPrunable: () => true,
      contextWindowTokensOverride: 1000,
    });
    const gate = decideWouldTrimGate(report);
    expect(gate.decision).toBe("go");
    expect(gate.reason).toContain("saved");
  });
});
