/**
 * T-B6 (TF-0126): working_memory must not be permanently skipped within one
 * attempt. With the regather gate on, a later model call re-queries the
 * channel, injects genuinely new Blocks written by the tool loop since the
 * last call (AC-1), deduplicates unchanged content by dedupKey/contentDigest
 * (AC-2), and every channel-level skip decision is visible in lineage (AC-3).
 * Gate off: legacy permanent skip, byte-identical behavior (AC-5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlock, ContextBlockSink } from "../../context-engine/block.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";
import { getContextOrchestratorCollection } from "../../context-engine/context-orchestrator.js";
import { endTurnInjectionBudget } from "../../context-engine/turn-injection-budget.js";
import { resetContextCandidateCollectionsForTests } from "../../context-engine/context-candidate.js";
import { WORKING_MEMORY_REGATHER_ENV } from "../../context-engine/working-memory-regather.js";
import { CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV } from "../../context-engine/enhancement-kill-switch.js";

type RegisteredHandler = (event: unknown, extra: unknown) => Promise<unknown> | unknown;

function createAgentRecorder() {
  const handlers: Record<string, RegisteredHandler[]> = {};
  return {
    handlers,
    get events() {
      return Object.keys(handlers);
    },
    on(event: string, handler: RegisteredHandler) {
      handlers[event] ??= [];
      handlers[event]?.push(handler);
      return Promise.resolve();
    },
  };
}

function baseFactoryParams(
  cfg: OpenClawConfig | undefined,
  workingMemoryStore: Pick<BlockStoreApi, "query" | "upsert">,
  injectionTurnId: string,
) {
  return {
    cfg,
    sessionManager: {} as SessionManager,
    workspaceDir: "C:/repo",
    provider: "openai",
    modelId: "gpt-test",
    model: undefined as ProviderRuntimeModel | undefined,
    sessionId: "runtime-session-id",
    sessionKey: "agent:alpha:main",
    contextBlockSink: undefined as ContextBlockSink | undefined,
    workingMemoryStore,
    injectionTurnId,
  };
}

function makeWorkingMemoryBlock(
  actions: Array<{ tool: string; result_summary: string; significance: string }>,
): ContextBlock {
  return {
    block_id: "working-memory:agent:alpha:main",
    block_type: "working_memory",
    source_system: "working-memory",
    session_id: "runtime-session-id",
    presence: { always_on: false, background: true },
    entities: [],
    valid_at: new Date("2026-08-25T00:00:00.000Z"),
    mutability: "system_managed",
    summary: "Recent actions",
    full_content: JSON.stringify({ actions }),
    compression_depth: 0,
    entity_extraction_status: "empty",
  } as unknown as ContextBlock;
}

function makeToolRegistryBlock(): ContextBlock {
  return {
    block_id: "cvk:tool-registry:runtime-session-id",
    block_type: "tool_registry",
    source_system: "cvk",
    session_id: "runtime-session-id",
    presence: { always_on: false, background: true },
    entities: [],
    valid_at: new Date("2026-08-25T00:00:00.000Z"),
    mutability: "system_managed",
    summary: "Tool registry",
    full_content: JSON.stringify({ entries: [{ resourceId: "demo_tool", title: "Demo Tool" }] }),
    compression_depth: 0,
    entity_extraction_status: "empty",
  } as unknown as ContextBlock;
}

const CFG: OpenClawConfig = {
  runtime: {
    contextBlock: {
      "working-memory": { enabled: true },
      "tool-registry": { enabled: true },
    },
  },
};

function messagesText(result: unknown): string {
  const messages = (result as { messages?: Array<{ content?: unknown }> } | undefined)?.messages ?? [];
  return messages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
}

async function driveToolResult(agent: ReturnType<typeof createAgentRecorder>, resultSummary: string) {
  for (const handler of agent.handlers.tool_result ?? []) {
    await handler(
      {
        type: "tool_result",
        toolName: "write",
        details: { working_memory: { result_summary: resultSummary, significance: "high" } },
      },
      {},
    );
  }
}

let bogusConfigPath: string | undefined;

beforeEach(() => {
  // Hermetic config face: point OPENCLAW_CONFIG_PATH at a missing file so
  // resolveKillSwitchConfig() resolves to undefined instead of reading
  // whatever real user config exists on the machine running the test.
  bogusConfigPath = path.join(os.tmpdir(), `tf0126-regather-${Date.now()}.json`);
  process.env.OPENCLAW_CONFIG_PATH = bogusConfigPath;
  process.env[WORKING_MEMORY_REGATHER_ENV] = "1";
});

afterEach(() => {
  delete process.env[WORKING_MEMORY_REGATHER_ENV];
  delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
  delete process.env.OPENCLAW_CONFIG_PATH;
  if (bogusConfigPath) {
    fs.rmSync(bogusConfigPath, { force: true });
    bogusConfigPath = undefined;
  }
  resetContextCandidateCollectionsForTests();
});

function buildAttempt(turnId: string, store: Pick<BlockStoreApi, "query" | "upsert">) {
  const agent = createAgentRecorder();
  for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(CFG, store, turnId))) {
    void factory(agent as unknown as ExtensionAPI);
  }
  const contextHandlers = agent.handlers.context ?? [];
  expect(contextHandlers.length).toBeGreaterThan(0);
  const callModel = async () => {
    let result: unknown;
    for (const handler of contextHandlers) {
      result = await handler({ type: "context", messages: [{ role: "user", content: "next" }] }, {});
    }
    return result;
  };
  return { agent, callModel };
}

describe("T-B6 (TF-0126): working_memory regather within one attempt", () => {
  it("AC-1/AC-3: new tool_result content enters the next model call and skips stay visible in lineage", async () => {
    const turnId = "tf0126-regather-ac1";
    const blocks: Record<string, ContextBlock> = {
      working_memory: makeWorkingMemoryBlock([
        { tool: "write", result_summary: "v1 action", significance: "high" },
      ]),
      tool_registry: makeToolRegistryBlock(),
    };
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async (params) =>
        (params.block_types ?? []).flatMap((type) => (blocks[type] ? [blocks[type]] : [])),
      upsert: async (block) => {
        blocks[block.block_type] = block;
        return { accepted: true };
      },
    };
    const { agent, callModel } = buildAttempt(turnId, store);
    try {
      // Model call 1: both channels inject.
      const first = await callModel();
      expect(messagesText(first)).toContain("v1 action");
      expect(messagesText(first)).toContain("## Tools (1 available)");

      // The tool loop writes a new working_memory action.
      await driveToolResult(agent, "v2 action");

      // Model call 2: updated working_memory content enters the projection,
      // while tool_registry (exactly-once) is channel-skipped — and that skip
      // decision is visible in lineage.
      const second = await callModel();
      expect(messagesText(second)).toContain("v2 action");

      const lineage = getContextOrchestratorCollection(turnId)?.projection?.lineage ?? [];
      const skippedRegistry = lineage.find(
        (entry) => entry.channel === "tool_registry" && entry.disposition === "skip",
      );
      expect(skippedRegistry).toBeDefined();
      expect(skippedRegistry?.reason).toBe("skip-channel");
      const reapplied = lineage.find(
        (entry) => entry.channel === "working_memory" && entry.charsApplied > 0,
      );
      expect(reapplied).toBeDefined();
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });

  it("AC-2: unchanged content is deduplicated by dedupKey, not re-injected", async () => {
    const turnId = "tf0126-regather-ac2";
    const blocks: Record<string, ContextBlock> = {
      working_memory: makeWorkingMemoryBlock([
        { tool: "write", result_summary: "stable action", significance: "high" },
      ]),
      tool_registry: makeToolRegistryBlock(),
    };
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async (params) =>
        (params.block_types ?? []).flatMap((type) => (blocks[type] ? [blocks[type]] : [])),
      upsert: async (block) => {
        blocks[block.block_type] = block;
        return { accepted: true };
      },
    };
    const { callModel } = buildAttempt(turnId, store);
    try {
      const first = await callModel();
      expect(messagesText(first)).toContain("stable action");

      // Model call 2 with unchanged content: nothing new may be injected.
      const second = await callModel();
      expect(messagesText(second)).not.toContain("stable action");

      // Model call 3: the re-collected candidate is dispositioned "duplicate".
      const third = await callModel();
      expect(messagesText(third)).not.toContain("stable action");
      const lineage = getContextOrchestratorCollection(turnId)?.projection?.lineage ?? [];
      const duplicate = lineage.find(
        (entry) => entry.channel === "working_memory" && entry.disposition === "duplicate",
      );
      expect(duplicate).toBeDefined();
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });

  it("AC-5: gate off keeps the legacy permanent skip byte-identical", async () => {
    delete process.env[WORKING_MEMORY_REGATHER_ENV];
    const turnId = "tf0126-regather-ac5";
    const blocks: Record<string, ContextBlock> = {
      working_memory: makeWorkingMemoryBlock([
        { tool: "write", result_summary: "v1 action", significance: "high" },
      ]),
      tool_registry: makeToolRegistryBlock(),
    };
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async (params) =>
        (params.block_types ?? []).flatMap((type) => (blocks[type] ? [blocks[type]] : [])),
      upsert: async (block) => {
        blocks[block.block_type] = block;
        return { accepted: true };
      },
    };
    const { agent, callModel } = buildAttempt(turnId, store);
    try {
      const first = await callModel();
      expect(messagesText(first)).toContain("v1 action");

      await driveToolResult(agent, "v2 action");

      // Legacy behavior: working_memory stays skipped for the rest of the
      // attempt; the new content never enters a projection.
      const second = await callModel();
      expect(messagesText(second)).not.toContain("v2 action");
      const lineage = getContextOrchestratorCollection(turnId)?.projection?.lineage ?? [];
      expect(lineage.filter((entry) => entry.reason === "skip-channel")).toHaveLength(0);
      expect(lineage.filter((entry) => entry.channel === "working_memory")).toHaveLength(0);
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });

  it("requirement-5: an engaged kill switch beats the regather gate", async () => {
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = "1";
    const turnId = "tf0126-regather-kill";
    const blocks: Record<string, ContextBlock> = {
      working_memory: makeWorkingMemoryBlock([
        { tool: "write", result_summary: "v1 action", significance: "high" },
      ]),
      tool_registry: makeToolRegistryBlock(),
    };
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async (params) =>
        (params.block_types ?? []).flatMap((type) => (blocks[type] ? [blocks[type]] : [])),
      upsert: async (block) => {
        blocks[block.block_type] = block;
        return { accepted: true };
      },
    };
    const { callModel } = buildAttempt(turnId, store);
    try {
      const first = await callModel();
      expect(messagesText(first)).not.toContain("v1 action");
      expect(messagesText(first)).not.toContain("## Tools (1 available)");
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });
});
