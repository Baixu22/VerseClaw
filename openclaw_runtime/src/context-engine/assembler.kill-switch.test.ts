/**
 * FP-P0-02: the enhancement kill switch must cut the Assembler from BOTH forms.
 *
 * Before this task `assemble()` called `isContextEnhancementKillSwitchEngaged()`
 * with no argument, so `runtime.contextEnhancement.killSwitch=true` was an empty
 * switch — only the env form worked. These cases pin the four-state matrix plus
 * the fail-closed behavior on unparseable config, and assert that the BlockStore
 * *query* is cut, not merely the injection text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextBlock } from "./block.js";
import { Assembler } from "./assembler.js";
import { CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV } from "./enhancement-kill-switch.js";
import { KILL_SWITCH_CONFIG_UNREADABLE } from "./kill-switch-config-source.js";

const CONFIG_KILL = { runtime: { contextEnhancement: { killSwitch: true } } };
const CONFIG_NO_KILL = { runtime: { contextEnhancement: { killSwitch: false } } };

function workingMemoryBlock(): ContextBlock {
  return {
    block_id: "wm-1",
    block_type: "working_memory",
    source_system: "working-memory",
    session_id: "session-kill",
    summary: "recent actions",
    full_content: JSON.stringify({
      actions: [{ tool: "write", result_summary: "Created handler", significance: "high" }],
    }),
    presence: { priority: 1 },
    mutability: "mutable",
    compression_depth: 0 as const,
    entity_extraction_status: "empty" as const,
  } as unknown as ContextBlock;
}

function toolRegistryBlock(): ContextBlock {
  return {
    block_id: "tr-1",
    block_type: "tool_registry",
    source_system: "cvk",
    session_id: "session-kill",
    summary: "tools",
    full_content: JSON.stringify({ tools: [{ name: "read", purpose: "read a file" }] }),
    presence: { priority: 1 },
    mutability: "mutable",
    compression_depth: 0 as const,
    entity_extraction_status: "empty" as const,
  } as unknown as ContextBlock;
}

function makeAssembler() {
  const query = vi.fn(async (params: { block_types?: string[] }) => {
    if (params.block_types?.includes("working_memory")) return [workingMemoryBlock()];
    if (params.block_types?.includes("tool_registry")) return [toolRegistryBlock()];
    return [];
  });
  const upsert = vi.fn();
  return { query, upsert, assembler: new Assembler({ workingMemoryStore: { query, upsert } }) };
}

const ALL_ON = {
  "runtime.contextBlock.working_memory.enabled": true,
  "runtime.contextBlock.tool_registry.enabled": true,
} as const;

describe("FP-P0-02 Assembler kill-switch matrix", () => {
  const prevEnv = process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];

  beforeEach(() => {
    delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
    else process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = prevEnv;
  });

  it("no kill: injects and queries (control case, proves the matrix is not vacuous)", async () => {
    const { query, assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: CONFIG_NO_KILL },
      { existing_output: messages },
      ALL_ON,
    );

    expect(query).toHaveBeenCalled();
    expect(result.output).not.toBe(messages);
    expect(JSON.stringify(result.output)).toContain("## Recent Actions");
  });

  it("config kill only: cuts injection AND the BlockStore query", async () => {
    const { query, assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: CONFIG_KILL },
      { existing_output: messages },
      ALL_ON,
    );

    expect(result.output).toBe(messages);
    expect(query).not.toHaveBeenCalled();
  });

  it("env kill only: cuts injection AND the BlockStore query", async () => {
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = "1";
    const { query, assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: CONFIG_NO_KILL },
      { existing_output: messages },
      ALL_ON,
    );

    expect(result.output).toBe(messages);
    expect(query).not.toHaveBeenCalled();
  });

  it("both kills engaged: still cut, no double-negative re-enable", async () => {
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = "1";
    const { query, assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: CONFIG_KILL },
      { existing_output: messages },
      ALL_ON,
    );

    expect(result.output).toBe(messages);
    expect(query).not.toHaveBeenCalled();
  });

  it("env kill=0 does not override a config kill (config kill is independent)", async () => {
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = "0";
    const { query, assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: CONFIG_KILL },
      { existing_output: messages },
      ALL_ON,
    );

    expect(result.output).toBe(messages);
    expect(query).not.toHaveBeenCalled();
  });

  it("unparseable cfg stays fail-closed (treated as kill, never as no-kill)", async () => {
    const { query, assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: KILL_SWITCH_CONFIG_UNREADABLE },
      { existing_output: messages },
      ALL_ON,
    );

    expect(result.output).toBe(messages);
    expect(query).not.toHaveBeenCalled();
  });

  it("config kill zeroes the injection accounting for this turn (FP-P0-05 consistency)", async () => {
    const { assembler } = makeAssembler();
    const messages = [{ role: "user" as const, content: "go" }];

    const result = await assembler.assemble(
      { session_id: "session-kill", cfg: CONFIG_KILL },
      { existing_output: messages },
      ALL_ON,
    );

    expect(result.selected_handlers).toEqual([]);
    expect(JSON.stringify(result.output)).not.toContain("## Recent Actions");
    expect(JSON.stringify(result.output)).not.toContain("## Tools");
  });
});
