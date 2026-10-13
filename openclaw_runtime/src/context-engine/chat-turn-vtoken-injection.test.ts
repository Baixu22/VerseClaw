/**
 * Unit tests for Verse Token Working Context injection (no Python worker required).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeVtokenExtraSystemPrompt,
  createVtokenPackCandidates,
  DEFAULT_VTOKEN_ASSEMBLY_CONFIG,
  loadVtokenDcsMemoryEntries,
  renderWorkingContextBlock,
  resolveVtokenAssemblyConfig,
  shouldAssembleVtokenWorkingContext,
} from "./chat-turn-vtoken-injection.js";
import type { VtokenRpcClient, VtokenRpcPackResult } from "./vtoken-rpc-client.js";
import { resetSharedVtokenRpcClientForTests } from "./vtoken-rpc-client.js";

function fakePack(prompt = "packed working context"): VtokenRpcPackResult {
  return {
    schema: "VtokenPackResult/v1",
    prompt,
    estimatedTokens: 42,
    allowanceTokens: 600,
    estimateMethod: "chars_div_4",
    slot_breakdown: {},
    nodes_included: ["n1"],
    nodes_evicted: [],
    dedup_count: 0,
    candidateCount: 1,
  };
}

function createMockClient(overrides: Partial<VtokenRpcClient> = {}): VtokenRpcClient {
  return {
    running: true,
    pid: 1,
    ensureStarted: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    pack: vi.fn(async () => fakePack()),
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
    const cfg = {
      ...DEFAULT_VTOKEN_ASSEMBLY_CONFIG,
      enabled: true,
      sessions: "main-only" as const,
    };
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
    const entries = await loadVtokenDcsMemoryEntries({ query }, "session-1", {
      runtime: {
        contextBlock: {
          "working-memory": { enabled: true },
          compass: { enabled: false },
        },
      },
    });
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
    const text = renderWorkingContextBlock(fakePack("hello world"));
    expect(text).toContain("## Working Context");
    expect(text).toContain("hello world");
    expect(text).toContain("estimated_tokens=42");
    expect(text).toContain("estimate_method=chars_div_4");
  });

  it("returns empty for blank prompt", () => {
    expect(renderWorkingContextBlock(fakePack("   "))).toBe("");
  });
});

describe("createVtokenPackCandidates", () => {
  it("emits stable duplicate-free candidates before the worker call", () => {
    const source = { sourcePath: "AGENTS.md", text: "# Rules" };
    const candidates = createVtokenPackCandidates({
      markdownSources: [source, { ...source }],
      memoryEntries: [
        { id: "m1", content: "remember this" },
        { id: "m1", content: "remember this" },
      ],
    });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.candidateId)).size).toBe(2);
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
        allowanceTokens: 600,
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
      },
      undefined,
      client,
    );
    expect(result).toBe("base");
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.pack).not.toHaveBeenCalled();
  });

  it("appends Working Context when sources are provided", async () => {
    const client = createMockClient();
    const result = await computeVtokenExtraSystemPrompt(
      "base prompt",
      { runtime: { vtoken: { assembly: { enabled: true } } } },
      {
        sessionKey: "agent:main:main",
        taskHint: "fix auth bug",
        allowanceTokens: 600,
        markdownSources: [{ sourcePath: "AGENTS.md", text: "# Agents\nPrefer tests." }],
      },
      undefined,
      client,
    );
    expect(result).toContain("base prompt");
    expect(result).toContain("## Working Context");
    expect(result).toContain("packed working context");
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.pack).toHaveBeenCalledWith(
      expect.objectContaining({
        allowanceTokens: 600,
        candidates: [expect.objectContaining({ kind: "markdown", sourcePath: "AGENTS.md" })],
      }),
    );
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
        allowanceTokens: 600,
        workspaceDir: "ignored-because-preloaded",
        markdownSources: [
          { sourcePath: "hooked-agents.md", text: "hook adjusted content" },
          { sourcePath: "should-not-be-read.md", text: "excluded" },
        ],
      },
      undefined,
      client,
    );
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.pack).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            kind: "markdown",
            text: "hook adjusted content",
            sourcePath: "hooked-agents.md",
          }),
        ],
      }),
    );
  });

  it("suppresses errors and returns original prompt", async () => {
    const client = createMockClient({
      pack: vi.fn(async () => {
        throw new Error("worker down");
      }),
    });
    const result = await computeVtokenExtraSystemPrompt(
      "keep me",
      {},
      {
        taskHint: "x",
        allowanceTokens: 600,
        markdownSources: [{ sourcePath: "a.md", text: "body" }],
      },
      undefined,
      client,
    );
    expect(result).toBe("keep me");
  });

  // FP-P1-182: the same bootstrap files and tool schemas are rendered in full by the
  // system prompt builder AND handed to VToken. Re-packing them adds no information and
  // makes the model arbitrate between two views of the same source.
  it("does not re-pack sources and tools the system prompt already renders", () => {
    const candidates = createVtokenPackCandidates({
      markdownSources: [
        { sourcePath: "AGENTS.md", text: "agents instructions" },
        { sourcePath: "notes.md", text: "notes" },
      ],
      toolSchemas: [
        { name: "read", description: "read a file" },
        { name: "custom_tool", description: "only in vtoken" },
      ],
      alreadyRenderedSourcePaths: ["AGENTS.md"],
      alreadyRenderedToolNames: ["read"],
    });

    const markdownPaths = candidates
      .filter((candidate) => candidate.kind === "markdown")
      .map((candidate) => (candidate as { sourcePath: string }).sourcePath);
    expect(markdownPaths).toEqual(["notes.md"]);
    // The tool the prompt does not carry still reaches VToken.
    expect(candidates.filter((candidate) => candidate.kind === "tool_schema")).toHaveLength(1);
  });

  it("keeps every candidate when nothing is already rendered", () => {
    const candidates = createVtokenPackCandidates({
      markdownSources: [{ sourcePath: "AGENTS.md", text: "agents instructions" }],
      toolSchemas: [{ name: "read", description: "read a file" }],
    });
    expect(candidates).toHaveLength(2);
  });

});
