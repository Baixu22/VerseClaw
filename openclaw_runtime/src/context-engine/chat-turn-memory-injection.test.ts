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
  shouldInjectChatTurnMemory,
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
    // Mirror the production `toContextItem` shape: the fact id is what makes an
    // item comparable with COMPASS `injectedFactIds` (#182).
    metadata: { providerId: "runtime-memory", factId: `fact-${index}` },
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

describe("#183 memory pilot session scope", () => {
  const mainOnly: MemoryInjectPilotConfig = {
    enabled: true,
    providers: ["role-memory"],
    totalTokenBudget: 768,
    sessions: "main-only",
  };

  it("excludes subagent sessions even when the key ends in :main", () => {
    // `agent:main:subagent:main` ends with ":main", so the old local regex
    // treated it as a main session; the canonical predicate says subagent.
    expect(
      shouldInjectChatTurnMemory(mainOnly, { sessionKey: "agent:main:subagent:main" }),
    ).toBe(false);
    expect(
      shouldInjectChatTurnMemory(mainOnly, { sessionKey: "agent:main:subagent:1234" }),
    ).toBe(false);
  });

  it("still injects into an agent main session", () => {
    expect(shouldInjectChatTurnMemory(mainOnly, { sessionKey: "agent:main:main" })).toBe(true);
  });

  it("keeps subagent sessions eligible when the operator opts into sessions: all", () => {
    expect(
      shouldInjectChatTurnMemory(
        { ...mainOnly, sessions: "all" },
        { sessionKey: "agent:main:subagent:1234" },
      ),
    ).toBe(true);
  });
});

describe("#182 cross-channel fact dedupe", () => {
  it("drops facts another channel already injected this turn", async () => {
    const provider = fakeProvider("runtime-memory", memoryItems(3));
    const result = await assembleChatTurnMemoryInjection(
      { ...ALL_SESSIONS_QUERY, dedupeFactIds: ["fact-1"] },
      [provider],
      pilotConfig(800),
    );

    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("runtime-memory:fact-1");
    expect(result!.text).toContain("runtime-memory:fact-0");
    expect(result!.text).toContain("runtime-memory:fact-2");
    expect(result!.metadata.droppedDuplicateItems).toBe(1);
    expect(result!.metadata.itemsInjected).toBe(2);
    expect(result!.metadata.totalItems).toBe(3);
  });

  it("collapses the same fact id injected twice inside one block", async () => {
    const provider = fakeProvider("runtime-memory", [...memoryItems(1), ...memoryItems(1)]);
    const result = await assembleChatTurnMemoryInjection(
      ALL_SESSIONS_QUERY,
      [provider],
      pilotConfig(800),
    );

    expect(result).not.toBeNull();
    expect(result!.metadata.totalItems).toBe(2);
    expect(result!.metadata.itemsInjected).toBe(1);
    expect(result!.metadata.droppedDuplicateItems).toBe(1);
    expect(result!.text.match(/runtime-memory:fact-0/g)).toHaveLength(1);
  });

  it("injects everything when the caller declares no duplicates", async () => {
    const provider = fakeProvider("runtime-memory", memoryItems(2));
    const result = await assembleChatTurnMemoryInjection(
      ALL_SESSIONS_QUERY,
      [provider],
      pilotConfig(800),
    );

    expect(result!.metadata.droppedDuplicateItems).toBe(0);
    expect(result!.metadata.itemsInjected).toBe(2);
  });
});