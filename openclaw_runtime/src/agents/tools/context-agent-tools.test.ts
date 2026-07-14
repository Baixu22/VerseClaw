import { describe, expect, it, vi } from "vitest";
import type {
  BlockEntityQuery,
  BlockQuery,
  BlockStoreApi,
  BlockStoreStats,
  ContextBlock,
  ContextBlockSink,
} from "../../context-engine/block.js";
import { CHILD_CONTEXT_READ_INSTRUCTION } from "../../context-engine/handlers/task-loop-handler.js";
import { createOpenClawCodingTools } from "../agent-tools.js";
import {
  CONTEXT_READ_TOOL_NAME,
  CONTEXT_SEARCH_TOOL_NAME,
  CONTEXT_WRITE_TOOL_NAME,
  DCS_CONTEXT_AGENT_TOOL_NAMES,
  createContextReadTool,
  createContextSearchTool,
  createContextWriteTool,
  createDcsContextAgentTools,
} from "./context-agent-tools.js";

function makeBlock(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    block_id: "task-state:session-a",
    block_type: "task_state",
    source_system: "task-loop",
    session_id: "session-a",
    presence: {
      always_on: false,
      on_demand: { expand_tool: "context_read", auto_register: false },
    },
    entities: [],
    valid_at: new Date("2026-07-12T00:00:00.000Z"),
    mutability: "system_managed",
    summary: "Phase: running",
    full_content: JSON.stringify({
      objective: "register tools",
      current_phase: "running",
      recent_actions: [],
      parent_session_id: "session-a",
    }),
    compression_depth: 0,
    entity_extraction_status: "empty",
    ...overrides,
  };
}

function makeBlockStore(
  overrides: {
    query?: (params: BlockQuery) => Promise<ContextBlock[]>;
    queryByEntity?: (params: BlockEntityQuery) => Promise<ContextBlock[]>;
  } = {},
): BlockStoreApi {
  const defaultStats: BlockStoreStats = {
    total_blocks: 0,
    valid_blocks: 0,
    entity_extraction_status: { pending: 0, failed: 0, empty: 0, success: 0 },
    admission_rejections: 0,
    authorization_rejections: 0,
  };
  return {
    upsert: vi.fn(async () => ({ accepted: true })),
    query: overrides.query ?? vi.fn(async () => [makeBlock()]),
    queryByEntity: overrides.queryByEntity ?? vi.fn(async () => [makeBlock({ block_type: "experience" })]),
    invalidate: vi.fn(async () => undefined),
    stats: vi.fn(async () => defaultStats),
  };
}

async function executeTool(tool: { execute: Function }, params: unknown) {
  return tool.execute("call-1", params);
}

describe("DCS Stage 5 context agent tools", () => {
  describe("schema + happy path", () => {
    it("context_read returns full_content for task_state", async () => {
      const query = vi.fn(async () => [makeBlock()]);
      const store = makeBlockStore({ query });
      const tool = createContextReadTool({
        sessionId: "session-a",
        blockStore: store,
      });
      expect(tool).not.toBeNull();
      expect(tool!.name).toBe(CONTEXT_READ_TOOL_NAME);
      expect(tool!.parameters).toBeDefined();

      const result = await executeTool(tool!, { block_type: "task_state" });
      const details = result.details as {
        ok: boolean;
        count: number;
        contents: string[];
      };
      expect(details.ok).toBe(true);
      expect(details.count).toBe(1);
      expect(details.contents[0]).toContain("register tools");
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          requester_session_id: "session-a",
          block_types: ["task_state"],
        }),
      );
    });

    it("context_search wraps searchContext", async () => {
      const queryByEntity = vi.fn(async () => [
        makeBlock({
          block_id: "exp:1",
          block_type: "experience",
          entities: ["postgresql"],
          full_content: "check pg config",
        }),
      ]);
      const store = makeBlockStore({ queryByEntity });
      const tool = createContextSearchTool({
        sessionId: "session-a",
        blockStore: store,
      });
      expect(tool!.name).toBe(CONTEXT_SEARCH_TOOL_NAME);
      const result = await executeTool(tool!, { query: "postgresql access" });
      const details = result.details as { ok: boolean; count: number; results: unknown[] };
      expect(details.ok).toBe(true);
      expect(details.count).toBe(1);
      expect(queryByEntity).toHaveBeenCalled();
    });

    it("context_write appends notes with write_origin", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) => {
        expect(writes[0]?.admission?.write_origin).toBe("context_write");
        expect(writes[0]?.block.block_type).toBe("notes");
        return [{ accepted: true }];
      });
      const store = makeBlockStore({
        query: vi.fn(async () => []),
      });
      const tool = createContextWriteTool({
        sessionId: "session-a",
        contextBlockSink: sink,
        blockStore: store,
        role: "implementer",
      });
      expect(tool!.name).toBe(CONTEXT_WRITE_TOOL_NAME);
      const result = await executeTool(tool!, {
        operation: "append",
        content: "note body",
      });
      const details = result.details as { accepted: boolean };
      expect(details.accepted).toBe(true);
      expect(sink).toHaveBeenCalled();
    });
  });

  describe("auth / reject paths", () => {
    it("omits tools when blockStore or sessionId missing", () => {
      expect(createContextReadTool({})).toBeNull();
      expect(createContextSearchTool({ sessionId: "s" })).toBeNull();
      expect(createContextWriteTool({ sessionId: "s" })).toBeNull();
      expect(createDcsContextAgentTools({})).toEqual([]);
    });

    it("context_write rejects non-whitelisted role", async () => {
      const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
      const tool = createContextWriteTool({
        sessionId: "session-a",
        contextBlockSink: sink,
        role: "observer",
      });
      const result = await executeTool(tool!, {
        operation: "append",
        content: "nope",
      });
      const details = result.details as { accepted: boolean; reason?: string };
      expect(details.accepted).toBe(false);
      expect(details.reason).toMatch(/whitelist/i);
      expect(sink).not.toHaveBeenCalled();
    });

    it("context_read reports empty when store returns no blocks (auth empty set)", async () => {
      const store = makeBlockStore({
        query: vi.fn(async () => []),
      });
      const tool = createContextReadTool({
        sessionId: "session-a",
        blockStore: store,
      });
      const result = await executeTool(tool!, { block_type: "task_state" });
      const details = result.details as { ok: boolean; count: number };
      expect(details.ok).toBe(true);
      expect(details.count).toBe(0);
    });
  });

  describe("production catalog registration", () => {
    it("createOpenClawCodingTools includes three names when DCS deps present", () => {
      const store = makeBlockStore();
      const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
      const tools = createOpenClawCodingTools({
        sessionId: "session-a",
        sessionKey: "agent:main:main",
        dcsBlockStore: store,
        dcsContextBlockSink: sink,
        // full profile so profile allowlist does not strip tools
        config: {
          tools: { profile: "full" },
        } as never,
      });
      const names = tools.map((t) => t.name);
      for (const name of DCS_CONTEXT_AGENT_TOOL_NAMES) {
        expect(names).toContain(name);
      }
    });

    it("createOpenClawCodingTools omits context tools without DCS deps", () => {
      const tools = createOpenClawCodingTools({
        sessionId: "session-a",
        sessionKey: "agent:main:main",
        config: {
          tools: { profile: "full" },
        } as never,
      });
      const names = new Set(tools.map((t) => t.name));
      expect(names.has(CONTEXT_READ_TOOL_NAME)).toBe(false);
      expect(names.has(CONTEXT_SEARCH_TOOL_NAME)).toBe(false);
      expect(names.has(CONTEXT_WRITE_TOOL_NAME)).toBe(false);
    });
  });

  describe("child instruction accuracy", () => {
    it("CHILD_CONTEXT_READ_INSTRUCTION names a registered tool", () => {
      expect(CHILD_CONTEXT_READ_INSTRUCTION).toContain("context_read");
      const store = makeBlockStore();
      const tools = createDcsContextAgentTools({
        sessionId: "child-session",
        blockStore: store,
        contextBlockSink: vi.fn(async () => [{ accepted: true }]),
      });
      const names = tools.map((t) => t.name);
      expect(names).toContain(CONTEXT_READ_TOOL_NAME);
      // Instruction remains accurate because the tool truly exists in the catalog builder.
      expect(names.some((n) => CHILD_CONTEXT_READ_INSTRUCTION.includes(n))).toBe(true);
    });
  });
});
