/**
 * Unit tests for Verse Token Working Context injection (no Python worker required).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeVtokenExtraSystemPrompt,
  DEFAULT_VTOKEN_ASSEMBLY_CONFIG,
  loadVtokenDcsMemoryEntries,
  renderWorkingContextBlock,
  resolveVtokenAssemblyConfig,
  shouldAssembleVtokenWorkingContext,
} from "./chat-turn-vtoken-injection.js";
import type { VtokenRpcAssembleResult, VtokenRpcClient } from "./vtoken-rpc-client.js";
import {
  resetSharedVtokenRpcClientForTests,
  VtokenRpcClient as RealVtokenRpcClient,
} from "./vtoken-rpc-client.js";

function fakeAssemble(prompt = "packed working context"): VtokenRpcAssembleResult {
  return {
    prompt,
    tokens_used: 42,
    tokens_budget: 600,
    slot_breakdown: {},
    nodes_included: ["n1"],
    nodes_evicted: [],
    dedup_count: 0,
  };
}

function createMockClient(overrides: Partial<VtokenRpcClient> = {}): VtokenRpcClient {
  return {
    opened: true,
    running: true,
    pid: 1,
    runExclusive: vi.fn(async (operation) => operation()),
    ensureStarted: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    open: vi.fn(async () => ({ ok: true })),
    ingestMarkdown: vi.fn(async () => undefined),
    ingestTools: vi.fn(async () => undefined),
    ingestMemory: vi.fn(async () => undefined),
    assemble: vi.fn(async () => fakeAssemble()),
    call: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as VtokenRpcClient;
}

describe("resolveVtokenAssemblyConfig", () => {
  const prev = process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
  const prevBridge = process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
  const prevKill = process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;

  beforeEach(() => {
    delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    else process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = prev;
    if (prevBridge === undefined) delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    else process.env.VERSE_VTOKEN_BRIDGE_ENABLED = prevBridge;
    if (prevKill === undefined) delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;
    else process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH = prevKill;
  });

  it("defaults to disabled (opt-in) with product budget", () => {
    const cfg = resolveVtokenAssemblyConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.budgetTokens).toBe(DEFAULT_VTOKEN_ASSEMBLY_CONFIG.budgetTokens);
    expect(cfg.renderMode).toBe("compact");
  });

  it("enables only with runtime.vtoken.assembly.enabled=true", () => {
    const cfg = resolveVtokenAssemblyConfig({
      runtime: { vtoken: { assembly: { enabled: true } } },
    });
    expect(cfg.enabled).toBe(true);
  });

  it("honors runtime.vtoken.assembly.enabled=false", () => {
    const cfg = resolveVtokenAssemblyConfig({
      runtime: { vtoken: { assembly: { enabled: false } } },
    });
    expect(cfg.enabled).toBe(false);
  });

  it("honors env canary VERSE_VTOKEN_ASSEMBLY_ENABLED=1", () => {
    process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = "1";
    const cfg = resolveVtokenAssemblyConfig({});
    expect(cfg.enabled).toBe(true);
  });

  it("honors env kill-switch VERSE_VTOKEN_ASSEMBLY_ENABLED=0", () => {
    process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = "0";
    const cfg = resolveVtokenAssemblyConfig({
      runtime: { vtoken: { assembly: { enabled: true } } },
    });
    expect(cfg.enabled).toBe(false);
  });

  it("honors enhancement kill switch over canary enable", () => {
    process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH = "1";
    const cfg = resolveVtokenAssemblyConfig({
      runtime: { vtoken: { assembly: { enabled: true } } },
    });
    expect(cfg.enabled).toBe(false);
  });
});

describe("shouldAssembleVtokenWorkingContext", () => {
  it("allows all sessions by default", () => {
    expect(
      shouldAssembleVtokenWorkingContext(
        { ...DEFAULT_VTOKEN_ASSEMBLY_CONFIG, enabled: true, sessions: "all" },
        "agent:main:work",
      ),
    ).toBe(true);
  });

  it("restricts main-only sessions", () => {
    const cfg = { ...DEFAULT_VTOKEN_ASSEMBLY_CONFIG, enabled: true, sessions: "main-only" as const };
    expect(shouldAssembleVtokenWorkingContext(cfg, "agent:main:main")).toBe(true);
    expect(shouldAssembleVtokenWorkingContext(cfg, "agent:main:sub")).toBe(false);
  });
});

describe("loadVtokenDcsMemoryEntries", () => {
  it("reuses the existing BlockStore only for enabled DCS sources", async () => {
    const query = vi.fn(async () => [
      {
        block_id: "wm-1",
        block_type: "working_memory" as const,
        source_system: "working-memory" as const,
        session_id: "session-1",
        presence: { always_on: false, priority: 1, background: true },
        entities: [],
        valid_at: new Date(),
        mutability: "system_managed" as const,
        summary: "edited auth middleware",
        compression_depth: 0 as const,
        entity_extraction_status: "empty" as const,
      },
    ]);
    const entries = await loadVtokenDcsMemoryEntries(
      { query },
      "session-1",
      {
        runtime: {
          contextBlock: {
            "working-memory": { enabled: true },
            compass: { enabled: false },
          },
        },
      },
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        requester_session_id: "session-1",
        source_systems: ["working-memory"],
      }),
    );
    expect(entries).toEqual([
      expect.objectContaining({
        id: "dcs.working-memory.wm-1",
        content: "edited auth middleware",
        tags: expect.arrayContaining(["dcs", "working_memory", "blocker"]),
      }),
    ]);
  });

  it("does not bypass default-off DCS feature flags", async () => {
    const query = vi.fn(async () => []);
    expect(await loadVtokenDcsMemoryEntries({ query }, "session-1", {})).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("renderWorkingContextBlock", () => {
  it("wraps assemble prompt under ## Working Context", () => {
    const text = renderWorkingContextBlock(fakeAssemble("hello world"));
    expect(text).toContain("## Working Context");
    expect(text).toContain("hello world");
    expect(text).toContain("tokens_used=42");
  });

  it("returns empty for blank prompt", () => {
    expect(renderWorkingContextBlock(fakeAssemble("   "))).toBe("");
  });
});

describe("VtokenRpcClient.runExclusive", () => {
  it("keeps complete store transactions from interleaving", async () => {
    const client = new RealVtokenRpcClient();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = client.runExclusive(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = client.runExclusive(async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await vi.waitFor(() => {
      expect(order).toEqual(["first:start"]);
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});

describe("computeVtokenExtraSystemPrompt", () => {
  afterEach(async () => {
    await resetSharedVtokenRpcClientForTests();
  });

  it("preserves prompt when disabled", async () => {
    const client = createMockClient();
    const result = await computeVtokenExtraSystemPrompt(
      "base",
      { runtime: { vtoken: { assembly: { enabled: false } } } },
      {
        sessionKey: "agent:main:main",
        taskHint: "fix auth",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
      },
      undefined,
      client,
    );
    expect(result).toBe("base");
    expect(client.assemble).not.toHaveBeenCalled();
  });

  it("appends Working Context when sources are provided", async () => {
    const client = createMockClient();
    const result = await computeVtokenExtraSystemPrompt(
      "base prompt",
      { runtime: { vtoken: { assembly: { enabled: true } } } },
      {
        sessionKey: "agent:main:main",
        taskHint: "fix auth bug",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "# Agents\nPrefer tests." }],
      },
      undefined,
      client,
    );
    expect(result).toContain("base prompt");
    expect(result).toContain("## Working Context");
    expect(result).toContain("packed working context");
    expect(client.open).toHaveBeenCalled();
    expect(client.ingestMarkdown).toHaveBeenCalled();
    expect(client.assemble).toHaveBeenCalled();
    expect(client.runExclusive).toHaveBeenCalledTimes(1);
  });

  it("uses bounded hook-adjusted sources instead of reopening an independent file set", async () => {
    const client = createMockClient();
    await computeVtokenExtraSystemPrompt(
      undefined,
      {
        runtime: {
          vtoken: {
            assembly: { enabled: true, maxSourceFiles: 1, maxSourceChars: 1_000 },
          },
        },
      },
      {
        taskHint: "x",
        workspaceDir: "ignored-because-preloaded",
        markdownSources: [
          { sourcePath: "hooked-agents.md", text: "hook adjusted content" },
          { sourcePath: "should-not-be-read.md", text: "excluded" },
        ],
      },
      undefined,
      client,
    );
    expect(client.ingestMarkdown).toHaveBeenCalledTimes(1);
    expect(client.ingestMarkdown).toHaveBeenCalledWith(
      "hook adjusted content",
      "hooked-agents.md",
    );
  });

  it("suppresses errors and returns original prompt", async () => {
    const client = createMockClient({
      assemble: vi.fn(async () => {
        throw new Error("worker down");
      }),
    });
    const result = await computeVtokenExtraSystemPrompt(
      "keep me",
      {},
      {
        taskHint: "x",
        markdownSources: [{ sourcePath: "a.md", text: "body" }],
      },
      undefined,
      client,
    );
    expect(result).toBe("keep me");
  });
});
