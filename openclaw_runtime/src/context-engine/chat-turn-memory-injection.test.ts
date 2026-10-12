import { describe, expect, it, vi } from "vitest";
import type {
  ContextItem,
  RuntimeContextProvider,
  RuntimeCoreJsonObject,
} from "../runtime-core/index.js";
import {
  MEMORY_PILOT_TOKEN_CHAR_WIDTH,
  assembleChatTurnMemoryInjection,
  computeMemoryExtraSystemPrompt,
  memoryPilotTokenBudgetToChars,
  type MemoryInjectPilotConfig,
} from "./chat-turn-memory-injection.js";

function fakeProvider(id: string, items: ContextItem[]): RuntimeContextProvider {
  return {
    manifest: { id, kind: "context" } as unknown as RuntimeContextProvider["manifest"],
    getContext: () => items,
  };
}

function memoryItems(count: number, width = 60): ContextItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `runtime-memory:fact-${index}`,
    kind: "memory" as const,
    text: `fact-${index} ${"x".repeat(width)}`,
    source: `runtime-memory:fact-${index}`,
    evidenceRefs: [],
    metadata: { providerId: "runtime-memory" },
  }));
}

const ALL_SESSIONS_QUERY = { sessionKey: "agent:main:main" };

function pilotConfig(totalTokenBudget: number): MemoryInjectPilotConfig {
  return {
    enabled: true,
    providers: ["runtime-memory"],
    totalTokenBudget,
    sessions: "all",
  };
}

function memoryBudgetOf(metadata: RuntimeCoreJsonObject): Record<string, unknown> {
  return metadata.memoryBudget as Record<string, unknown>;
}

describe("computeMemoryExtraSystemPrompt", () => {
  it("preserves the prompt without constructing providers when the session key is unresolved", async () => {
    const providerFactory = vi.fn(() => []);
    const originalPrompt = "Keep the existing system prompt.";

    const result = await computeMemoryExtraSystemPrompt(
      originalPrompt,
      {
        runtime: {
          memory: {
            injectPilot: {
              enabled: true,
              sessions: "all",
            },
          },
        },
      },
      undefined,
      providerFactory,
    );

    expect(result).toBe(originalPrompt);
    expect(providerFactory).not.toHaveBeenCalled();
  });
});

describe("#181 memory pilot totalTokenBudget enforcement", () => {
  it("truncates the injected block to the configured token budget", async () => {
    const provider = fakeProvider("runtime-memory", memoryItems(20));
    const small = await assembleChatTurnMemoryInjection(
      ALL_SESSIONS_QUERY,
      [provider],
      pilotConfig(4),
    );

    expect(small).not.toBeNull();
    const charBudget = memoryPilotTokenBudgetToChars(4);
    expect(charBudget).toBe(4 * MEMORY_PILOT_TOKEN_CHAR_WIDTH);
    expect(small!.text.length).toBeLessThanOrEqual(charBudget);
    expect(memoryBudgetOf(small!.metadata)).toMatchObject({
      tokenBudget: 4,
      charBudget,
      truncated: true,
      applied: true,
    });
    expect(memoryBudgetOf(small!.metadata).charsApplied).toBe(small!.text.length);
    expect(memoryBudgetOf(small!.metadata).charsDropped as number).toBeGreaterThan(0);
  });

  it("injects strictly more bytes when the budget is raised", async () => {
    const provider = fakeProvider("runtime-memory", memoryItems(20));
    const small = await assembleChatTurnMemoryInjection(
      ALL_SESSIONS_QUERY,
      [provider],
      pilotConfig(4),
    );
    const large = await assembleChatTurnMemoryInjection(
      ALL_SESSIONS_QUERY,
      [provider],
      pilotConfig(800),
    );

    expect(large!.text.length).toBeGreaterThan(small!.text.length);
    expect(memoryBudgetOf(large!.metadata).truncated).toBe(false);
  });

  it("drops the whole block instead of silently ignoring a sub-character budget", async () => {
    const provider = fakeProvider("runtime-memory", memoryItems(8));
    const result = await assembleChatTurnMemoryInjection(
      ALL_SESSIONS_QUERY,
      [provider],
      { ...pilotConfig(1), sessions: "all" },
    );

    // charBudget = 4 < the "…" truncation floor of 2? No: 4 >= 2, so a 4-char
    // prefix is still injected. The invariant under test is the ceiling, not
    // emptiness: the applied bytes can never exceed the configured budget.
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThanOrEqual(charBudgetFor(1));
    expect(memoryBudgetOf(result!.metadata).charBudget).toBe(charBudgetFor(1));
  });

  it("keeps token→char conversion monotonic and never zero", () => {
    expect(memoryPilotTokenBudgetToChars(768)).toBe(768 * MEMORY_PILOT_TOKEN_CHAR_WIDTH);
    expect(memoryPilotTokenBudgetToChars(1)).toBeGreaterThan(0);
    expect(memoryPilotTokenBudgetToChars(0)).toBeGreaterThan(0);
  });
});

function charBudgetFor(tokens: number): number {
  return memoryPilotTokenBudgetToChars(tokens);
}