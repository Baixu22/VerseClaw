import { describe, expect, it, vi } from "vitest";
import { buildContextPack } from "../memory/context-pack.js";
import { isMainSessionKey } from "../sessions/session-key-utils.js";
import {
  Assembler,
  contextBlockFlagNameForSourceSystem,
  DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
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
  });

  it("covers every default flag key exactly once", () => {
    const mapped = (["compass", "role-memory", "working-memory"] as const).map((sourceSystem) =>
      contextBlockFlagNameForSourceSystem(sourceSystem),
    );
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