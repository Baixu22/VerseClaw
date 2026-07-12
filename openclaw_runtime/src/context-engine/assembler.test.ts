import { describe, expect, it, vi } from "vitest";
import { buildContextPack } from "../memory/context-pack.js";
import { isMainSessionKey } from "../sessions/session-key-utils.js";
import type { ContextBlock, ContextBlockSink } from "./block.js";
import {
  Assembler,
  contextBlockFlagNameForSourceSystem,
  DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
  KNOWLEDGE_INJECTION_CHAR_BUDGET,
  selectHandlers,
} from "./assembler.js";

describe("DCS Assembler", () => {
  it("使用共享谓词窄化 main session", () => {
    expect(isMainSessionKey("main")).toBe(true);
    expect(isMainSessionKey("agent:alpha:main")).toBe(true);
    expect(isMainSessionKey("agent:alpha:main:thread:one")).toBe(false);
    expect(isMainSessionKey("subagent:child")).toBe(false);
    expect(isMainSessionKey(undefined)).toBe(false);
  });

  it.each([
    ["main", ["compass"]],
    ["agent:alpha:main", ["compass"]],
    ["subagent:child", ["role_memory"]],
    ["agent:alpha:subagent:child:turn:2", ["role_memory"]],
    ["acp:worker", []],
    ["agent:alpha:acp:worker", []],
    ["agent:alpha:cron:job:run:run-id", []],
    ["agent:alpha:discord:channel:123", []],
  ] as const)("按 session 类型选择 %s 的 legacy handler", (session_id, expected) => {
    expect(selectHandlers({ session_id })).toEqual(expected);
  });

  it("两个 feature flag 默认 false，并保持 identity pass-through", async () => {
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS).toEqual({
      "runtime.contextBlock.compass.enabled": false,
      "runtime.contextBlock.role_memory.enabled": false,
      "runtime.contextBlock.working_memory.enabled": false,
      "runtime.contextBlock.tool_registry.enabled": false,
    });
    const buildCompass = vi.fn(async () => ({ iFrameRefreshed: false }));
    const buildRoleMemory = vi.fn(() => buildContextPack({}));
    const assembler = new Assembler({ buildCompass, buildRoleMemory });
    const existingOutput = { prompt: "unchanged" };

    const result = await assembler.assemble(
      { session_id: "main" },
      {
        existing_output: existingOutput,
        compass: { userInputText: "hello" },
        role_memory: {},
      },
    );

    expect(result.output).toBe(existingOutput);
    expect(result.selected_handlers).toEqual([]);
    expect(result.compass).toBeUndefined();
    expect(result.role_memory).toBeUndefined();
    expect(buildCompass).not.toHaveBeenCalled();
    expect(buildRoleMemory).not.toHaveBeenCalled();
  });

  it("同时满足 session、flag、input 时才调用对应 builder", async () => {
    const buildCompass = vi.fn(async () => ({ iFrameRefreshed: false }));
    const buildRoleMemory = vi.fn(() => buildContextPack({}));
    const assembler = new Assembler({ buildCompass, buildRoleMemory });
    const flags = {
      "runtime.contextBlock.compass.enabled": true,
      "runtime.contextBlock.role_memory.enabled": true,
    };
    const existingOutput = { prompt: "legacy" };

    const mainResult = await assembler.assemble(
      { session_id: "agent:alpha:main" },
      {
        existing_output: existingOutput,
        compass: { userInputText: "main input" },
        role_memory: {},
      },
      flags,
    );
    expect(mainResult.output).toBe(existingOutput);
    expect(mainResult.selected_handlers).toEqual(["compass"]);
    expect(mainResult.compass).toEqual({ iFrameRefreshed: false });
    expect(mainResult.role_memory).toBeUndefined();
    expect(buildCompass).toHaveBeenCalledWith({
      sessionKey: "agent:alpha:main",
      userInputText: "main input",
    });
    expect(buildRoleMemory).not.toHaveBeenCalled();

    buildCompass.mockClear();
    const subagentResult = await assembler.assemble(
      { session_id: "agent:alpha:subagent:child" },
      {
        existing_output: existingOutput,
        compass: { userInputText: "ignored" },
        role_memory: { roleName: "implementer" },
      },
      flags,
    );
    expect(subagentResult.selected_handlers).toEqual(["role_memory"]);
    expect(subagentResult.role_memory).toEqual(buildContextPack({ roleName: "implementer" }));
    expect(subagentResult.compass).toBeUndefined();
    expect(buildRoleMemory).toHaveBeenCalledWith({ roleName: "implementer" });
    expect(buildCompass).not.toHaveBeenCalled();
  });

  it("flag 开启但 input 缺失时不调用也不报错", async () => {
    const buildCompass = vi.fn(async () => ({ iFrameRefreshed: false }));
    const assembler = new Assembler({ buildCompass });

    const result = await assembler.assemble(
      { session_id: "main" },
      { existing_output: "same" },
      { "runtime.contextBlock.compass.enabled": true },
    );

    expect(result).toEqual({ output: "same", selected_handlers: [] });
    expect(buildCompass).not.toHaveBeenCalled();
  });

  it("working_memory flag 开启后只读 BlockStore 并注入 Recent Actions", async () => {
    const messages = [{ role: "user" as const, content: "next" }];
    const query = vi.fn(async () => [
      {
        block_id: "working-memory:session-a",
        block_type: "working_memory" as const,
        source_system: "working-memory" as const,
        session_id: "session-a",
        presence: { always_on: false, background: true },
        entities: [],
        valid_at: new Date("2026-07-10T00:00:00.000Z"),
        mutability: "system_managed" as const,
        summary: "Recent actions",
        full_content: JSON.stringify({
          actions: [
            { tool: "write", result_summary: "Created handler", significance: "high" },
            { tool: "test", result_summary: "Ran focused tests", significance: "medium" },
          ],
        }),
        compression_depth: 0 as const,
        entity_extraction_status: "empty" as const,
      },
    ]);
    const upsert = vi.fn();
    const assembler = new Assembler({ workingMemoryStore: { query, upsert } });

    const disabled = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
    );
    expect(disabled.output).toBe(messages);
    expect(query).not.toHaveBeenCalled();

    const enabled = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
      { "runtime.contextBlock.working_memory.enabled": true },
    );

    expect(query).toHaveBeenCalledWith({
      requester_session_id: "session-a",
      session_id: "session-a",
      block_types: ["working_memory"],
      source_systems: ["working-memory"],
      limit: 1,
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(enabled.output).not.toBe(messages);
    expect(JSON.stringify(enabled.output)).toContain("## Recent Actions");
    expect(JSON.stringify(enabled.output)).toContain("Created handler");
  });
});

describe("DCS v1.6.1 addendum 1: unique kebab/snake flag mapping", () => {
  it("maps each canonical source system to exactly one assembler flag key", () => {
    expect(contextBlockFlagNameForSourceSystem("compass")).toBe(
      "runtime.contextBlock.compass.enabled",
    );
    expect(contextBlockFlagNameForSourceSystem("role-memory")).toBe(
      "runtime.contextBlock.role_memory.enabled",
    );
    expect(contextBlockFlagNameForSourceSystem("working-memory")).toBe(
      "runtime.contextBlock.working_memory.enabled",
    );
    expect(contextBlockFlagNameForSourceSystem("cvk")).toBe(
      "runtime.contextBlock.tool_registry.enabled",
    );
  });

  it("covers every default flag key exactly once", () => {
    const mapped = (
      ["compass", "role-memory", "working-memory", "cvk"] as const
    ).map((sourceSystem) => contextBlockFlagNameForSourceSystem(sourceSystem));
    expect([...mapped].sort()).toEqual(Object.keys(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS).sort());
    expect(new Set(mapped).size).toBe(mapped.length);
  });
});

describe("DCS v1.6.1 addendum 2: exactly-once working-memory injection", () => {
  const storeWithWindow = () => ({
    query: vi.fn(async () => [
      {
        block_id: "working-memory:session-a",
        block_type: "working_memory" as const,
        source_system: "working-memory" as const,
        session_id: "session-a",
        presence: { always_on: false, background: true },
        entities: [],
        valid_at: new Date("2026-07-10T00:00:00.000Z"),
        mutability: "system_managed" as const,
        summary: "Recent actions",
        full_content: JSON.stringify({
          actions: [
            { tool: "write", result_summary: "Created handler", significance: "high" },
          ],
        }),
        compression_depth: 0 as const,
        entity_extraction_status: "empty" as const,
      },
    ]),
    upsert: vi.fn(),
  });

  it("keeps exactly one Recent Actions heading when both injection points assemble", async () => {
    const flags = { "runtime.contextBlock.working_memory.enabled": true } as const;
    const perCallHookAssembler = new Assembler({ workingMemoryStore: storeWithWindow() });
    const contextEngineAssembler = new Assembler({ workingMemoryStore: storeWithWindow() });
    const messages = [{ role: "user" as const, content: "next" }];

    const afterHook = await perCallHookAssembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
      flags,
    );
    const afterContextEngine = await contextEngineAssembler.assemble(
      { session_id: "session-a" },
      { existing_output: afterHook.output },
      flags,
    );

    expect(countRecentActionsHeadings(afterContextEngine.output)).toBe(1);
  });

  it("injects zero headings when the window is empty at both points", async () => {
    const emptyStore = { query: vi.fn(async () => []), upsert: vi.fn() };
    const assembler = new Assembler({ workingMemoryStore: emptyStore });
    const flags = { "runtime.contextBlock.working_memory.enabled": true } as const;
    const messages = [{ role: "user" as const, content: "next" }];

    const first = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
      flags,
    );
    const second = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: first.output },
      flags,
    );

    expect(countRecentActionsHeadings(second.output)).toBe(0);
  });
});

function countRecentActionsHeadings(output: unknown): number {
  if (!Array.isArray(output)) {
    return 0;
  }
  return output.filter(
    (message) =>
      typeof (message as { content?: unknown }).content === "string" &&
      /^## Recent Actions$/m.test((message as { content: string }).content),
  ).length;
}

describe("DCS Stage 3: tool_registry Assembler injection", () => {
  const storeWithToolRegistry = () => ({
    query: vi.fn(async () => [
      {
        block_id: "tool-registry:session-a",
        block_type: "tool_registry" as const,
        source_system: "cvk" as const,
        session_id: "session-a",
        presence: { always_on: true, token_budget: 200, priority: 7 },
        entities: [],
        valid_at: new Date("2026-07-12T00:00:00.000Z"),
        mutability: "system_managed" as const,
        summary: "## Tools (2 available)",
        full_content: JSON.stringify({
          entries: [
            { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit a file" },
            { resourceId: "write", kind: "toolset", title: "Write", purpose: "Write a file" },
          ],
        }),
        compression_depth: 0 as const,
        entity_extraction_status: "empty" as const,
      },
    ]),
    upsert: vi.fn(),
  });

  it("flag off: no query, no injection, identity pass-through", async () => {
    const store = storeWithToolRegistry();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
    );

    expect(result.output).toBe(messages);
    expect(store.query).not.toHaveBeenCalled();
  });

  it("flag on: queries BlockStore and injects ## Tools heading", async () => {
    const store = storeWithToolRegistry();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
      { "runtime.contextBlock.tool_registry.enabled": true },
    );

    expect(store.query).toHaveBeenCalledWith({
      requester_session_id: "session-a",
      session_id: "session-a",
      block_types: ["tool_registry"],
      source_systems: ["cvk"],
      limit: 1,
    });
    expect(JSON.stringify(result.output)).toContain("## Tools (2 available)");
    expect(JSON.stringify(result.output)).toContain("context_read('tool_registry')");
  });

  it("exactly-once: does not duplicate ## Tools heading", async () => {
    const store = storeWithToolRegistry();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [
      { role: "user" as const, content: "## Tools (2 available)\n→ context_read('tool_registry') for full schema" },
    ];

    const result = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
      { "runtime.contextBlock.tool_registry.enabled": true },
    );

    expect(countToolsHeadings(result.output)).toBe(1);
  });

  it("empty BlockStore: no injection", async () => {
    const emptyStore = { query: vi.fn(async () => []), upsert: vi.fn() };
    const assembler = new Assembler({ workingMemoryStore: emptyStore });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "session-a" },
      { existing_output: messages },
      { "runtime.contextBlock.tool_registry.enabled": true },
    );

    expect(countToolsHeadings(result.output)).toBe(0);
  });

  it("cvk maps to runtime.contextBlock.tool_registry.enabled", () => {
    expect(contextBlockFlagNameForSourceSystem("cvk")).toBe(
      "runtime.contextBlock.tool_registry.enabled",
    );
  });
});

function countToolsHeadings(output: unknown): number {
  if (!Array.isArray(output)) {
    return 0;
  }
  return output.filter(
    (message) =>
      typeof (message as { content?: unknown }).content === "string" &&
      /^## Tools \(\d+ available\)$/m.test((message as { content: string }).content),
  ).length;
}

function countKnowledgeHeadings(output: unknown): number {
  if (!Array.isArray(output)) {
    return 0;
  }
  return output.filter(
    (message) =>
      typeof (message as { content?: unknown }).content === "string" &&
      /^## Knowledge$/m.test((message as { content: string }).content),
  ).length;
}

describe("DCS Stage 4: knowledge Assembler injection", () => {
  const compassKnowledgeBlock = {
    block_id: "knowledge:compass:agent:alpha:main",
    block_type: "knowledge" as const,
    source_system: "compass" as const,
    session_id: "agent:alpha:main",
    presence: {
      always_on: false,
      token_budget: 400,
      priority: 5,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities: [],
    valid_at: new Date("2026-07-12T00:00:00.000Z"),
    mutability: "system_managed" as const,
    summary: "## Knowledge",
    full_content: "## SSP\nobjective: ship feature",
    compression_depth: 0 as const,
    entity_extraction_status: "empty" as const,
  };

  const roleMemoryKnowledgeBlock = {
    block_id: "knowledge:role-memory:agent:alpha:subagent:child",
    block_type: "knowledge" as const,
    source_system: "role-memory" as const,
    session_id: "agent:alpha:subagent:child",
    presence: {
      always_on: false,
      token_budget: 400,
      priority: 5,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities: [],
    valid_at: new Date("2026-07-12T00:00:00.000Z"),
    mutability: "system_managed" as const,
    summary: "## Knowledge",
    full_content: JSON.stringify({
      buckets: { role: ["objective: implement feature"] },
    }),
    compression_depth: 0 as const,
    entity_extraction_status: "empty" as const,
  };

  // Filter-aware mock store: returns blocks matching the queried source_systems.
  const createStoreWithBlocks = (blocks: ContextBlock[]) => ({
    query: vi.fn(async (params: { source_systems?: string[] }) => {
      const requested = params.source_systems ?? [];
      return blocks.filter((b) => requested.includes(b.source_system));
    }),
    upsert: vi.fn(),
  });

  const storeWithCompassKnowledge = () => createStoreWithBlocks([compassKnowledgeBlock]);
  const storeWithRoleMemoryKnowledge = () => createStoreWithBlocks([roleMemoryKnowledgeBlock]);

  it("compass flag off: no query, no injection, identity pass-through", async () => {
    const store = storeWithCompassKnowledge();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:main" },
      { existing_output: messages },
    );

    expect(result.output).toBe(messages);
    // working_memory and tool_registry flags are off, so no query should happen
    // for knowledge either (knowledge query only fires when compass or role_memory
    // flag is on).
    expect(countKnowledgeHeadings(result.output)).toBe(0);
  });

  it("compass flag on (main session): queries BlockStore and injects ## Knowledge", async () => {
    const store = storeWithCompassKnowledge();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:main" },
      { existing_output: messages },
      { "runtime.contextBlock.compass.enabled": true },
    );

    expect(store.query).toHaveBeenCalledWith({
      requester_session_id: "agent:alpha:main",
      session_id: "agent:alpha:main",
      block_types: ["knowledge"],
      source_systems: ["compass"],
      limit: 1,
    });
    expect(countKnowledgeHeadings(result.output)).toBe(1);
    expect(JSON.stringify(result.output)).toContain("## SSP");
    expect(JSON.stringify(result.output)).toContain("objective: ship feature");
  });

  it("ANTI-3: compass flag on but subagent session — queries role-memory, not compass", async () => {
    const store = createStoreWithBlocks([compassKnowledgeBlock, roleMemoryKnowledgeBlock]);
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:subagent:child" },
      { existing_output: messages },
      { "runtime.contextBlock.compass.enabled": true },
    );

    // ANTI-3: subagent sessions never query compass source_systems.
    const queryCalls = (store.query as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of queryCalls) {
      const params = call[0] as { source_systems?: string[]; block_types?: string[] };
      if (params.block_types?.includes("knowledge")) {
        expect(params.source_systems).not.toContain("compass");
      }
    }
    // Compass content must never appear in subagent output.
    expect(JSON.stringify(result.output)).not.toContain("objective: ship feature");
  });

  it("role_memory flag on (subagent session): queries BlockStore and injects ## Knowledge", async () => {
    const store = storeWithRoleMemoryKnowledge();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:subagent:child" },
      { existing_output: messages },
      { "runtime.contextBlock.role_memory.enabled": true },
    );

    expect(store.query).toHaveBeenCalledWith({
      requester_session_id: "agent:alpha:subagent:child",
      session_id: "agent:alpha:subagent:child",
      block_types: ["knowledge"],
      source_systems: ["role-memory"],
      limit: 1,
    });
    expect(countKnowledgeHeadings(result.output)).toBe(1);
    expect(JSON.stringify(result.output)).toContain("objective: implement feature");
  });

  it("ANTI-3: role_memory flag on but main session — queries compass, not role-memory", async () => {
    const store = createStoreWithBlocks([compassKnowledgeBlock, roleMemoryKnowledgeBlock]);
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:main" },
      { existing_output: messages },
      { "runtime.contextBlock.role_memory.enabled": true },
    );

    // ANTI-3: main sessions never query role-memory source_systems.
    const queryCalls = (store.query as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of queryCalls) {
      const params = call[0] as { source_systems?: string[]; block_types?: string[] };
      if (params.block_types?.includes("knowledge")) {
        expect(params.source_systems).not.toContain("role-memory");
      }
    }
    // Role-memory content must never appear in main output.
    expect(JSON.stringify(result.output)).not.toContain("objective: implement feature");
    // Flag-off guard: compass flag is OFF, so compass content must not appear either.
    expect(JSON.stringify(result.output)).not.toContain("objective: ship feature");
  });

  it("exactly-once: does not duplicate ## Knowledge heading", async () => {
    const store = storeWithCompassKnowledge();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [
      { role: "user" as const, content: "## Knowledge\nexisting content" },
    ];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:main" },
      { existing_output: messages },
      { "runtime.contextBlock.compass.enabled": true },
    );

    expect(countKnowledgeHeadings(result.output)).toBe(1);
  });

  it("empty BlockStore: no injection", async () => {
    const emptyStore = { query: vi.fn(async () => []), upsert: vi.fn() };
    const assembler = new Assembler({ workingMemoryStore: emptyStore });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:main" },
      { existing_output: messages },
      { "runtime.contextBlock.compass.enabled": true },
    );

    expect(countKnowledgeHeadings(result.output)).toBe(0);
  });

  it("addendum 4: config-aware mainKey routes custom mainKey to compass", async () => {
    const store = storeWithCompassKnowledge();
    const assembler = new Assembler({ workingMemoryStore: store });
    const messages = [{ role: "user" as const, content: "next" }];

    const result = await assembler.assemble(
      { session_id: "agent:alpha:primary", mainKey: "primary" },
      { existing_output: messages },
      { "runtime.contextBlock.compass.enabled": true },
    );

    expect(store.query).toHaveBeenCalledWith({
      requester_session_id: "agent:alpha:primary",
      session_id: "agent:alpha:primary",
      block_types: ["knowledge"],
      source_systems: ["compass"],
      limit: 1,
    });
    expect(countKnowledgeHeadings(result.output)).toBe(1);
  });

  it("compass maps to runtime.contextBlock.compass.enabled", () => {
    expect(contextBlockFlagNameForSourceSystem("compass")).toBe(
      "runtime.contextBlock.compass.enabled",
    );
  });

  it("role-memory maps to runtime.contextBlock.role_memory.enabled", () => {
    expect(contextBlockFlagNameForSourceSystem("role-memory")).toBe(
      "runtime.contextBlock.role_memory.enabled",
    );
  });

  it("addendum 6: KNOWLEDGE_INJECTION_CHAR_BUDGET is declared", () => {
    expect(KNOWLEDGE_INJECTION_CHAR_BUDGET).toBeGreaterThan(0);
    expect(typeof KNOWLEDGE_INJECTION_CHAR_BUDGET).toBe("number");
  });

  it("compass flag on + sink: produces knowledge Block from PreReplyInjection", async () => {
    const store = storeWithCompassKnowledge();
    const sink: ContextBlockSink = vi.fn(async (writes) =>
      writes.map(() => ({ accepted: true })),
    );
    const buildCompass = vi.fn(async () => ({
      sspString: "## SSP\nobjective: ship feature",
      top5FactsString: "## Top 5 Facts\n- fact A",
      iFrameRefreshed: false,
    }));
    const assembler = new Assembler({
      buildCompass,
      buildRoleMemory: () => ({} as never),
      workingMemoryStore: store,
      contextBlockSink: sink,
    });
    const messages = [{ role: "user" as const, content: "next" }];

    await assembler.assemble(
      { session_id: "agent:alpha:main" },
      { existing_output: messages, compass: { userInputText: "hello" } },
      { "runtime.contextBlock.compass.enabled": true },
    );

    expect(buildCompass).toHaveBeenCalledWith({
      sessionKey: "agent:alpha:main",
      userInputText: "hello",
    });
    expect(sink).toHaveBeenCalledTimes(1);
    const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      block: { block_type: string; source_system: string };
      admission: { significance: string; write_origin: string };
    }>;
    expect(writeArg[0].block.block_type).toBe("knowledge");
    expect(writeArg[0].block.source_system).toBe("compass");
  });
});