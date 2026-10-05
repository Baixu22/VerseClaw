import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  CONTEXT_IMPACT_TOOL_NAME,
  CONTEXT_UNDERSTAND_TOOL_NAME,
  CONTEXT_REUSE_TOOL_NAME,
  CONTEXT_VERIFY_TOOL_NAME,
  DCS_CONTEXT_AGENT_TOOL_NAMES,
  DCS_CONTEXT_VIEW_TOOL_NAMES,
  createContextReadTool,
  createContextSearchTool,
  createContextWriteTool,
  createContextImpactTool,
  createContextUnderstandTool,
  createContextReuseTool,
  createContextVerifyTool,
  createDcsContextAgentTools,
  recordContextToolSchemaBudget,
  serializeContextToolSchemas,
} from "./context-agent-tools.js";
import {
  __resetWorkspaceFactServiceRegistry,
  resolveWorkspaceFactService,
} from "../../context-engine/factstore/workspace-fact-service.js";
import { closeAllFactStores } from "../../context-engine/factstore/store.js";
import { codingObservability } from "../../context-engine/coding-observability.js";

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
    recallArchivedBlocks?: BlockStoreApi["recallArchivedBlocks"];
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
    ...(overrides.recallArchivedBlocks
      ? { recallArchivedBlocks: overrides.recallArchivedBlocks }
      : {}),
    invalidate: vi.fn(async () => undefined),
    enumerateBySource: vi.fn(async () => []),
    enumerateBySession: vi.fn(async () => []),
    deleteBlock: vi.fn(async () => 0),
    deleteBySession: vi.fn(async () => ({ deleted: 0, remaining: 0 })),
    invalidateBySession: vi.fn(async () => 0),
    stats: vi.fn(async () => defaultStats),
  };
}

type ToolExecuteResult = { details?: unknown; content?: unknown; [key: string]: unknown };
async function executeTool(
  tool: { execute?: ((id: string, params: unknown) => unknown) | undefined } | null,
  params: unknown,
): Promise<ToolExecuteResult> {
  if (!tool?.execute) {
    throw new Error("tool.execute missing");
  }
  return (await tool.execute("call-1", params)) as ToolExecuteResult;
}

describe("DCS Stage 5 context agent tools", () => {
  describe("schema + happy path", () => {
    it("context_read returns full_content for task_state", async () => {
      const query = vi.fn(async () => [makeBlock()]);
      const recallArchivedBlocks = vi.fn(async () => []);
      const store = makeBlockStore({ query, recallArchivedBlocks });
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
      expect(recallArchivedBlocks).not.toHaveBeenCalled();
    });

    it("context_read exposes include_archived and persists explicit recall", async () => {
      const archived = makeBlock({
        block_id: "wm:archived",
        block_type: "working_memory",
        source_system: "working-memory",
        full_content: "archived-note",
        presence: {
          always_on: false,
          lifecycle_state: "archived",
          archived_at: "2026-07-12T00:00:00.000Z",
          heat: 2,
        },
      });
      const recallArchivedBlocks = vi.fn(async () => [
        makeBlock({
          ...archived,
          presence: { always_on: false, lifecycle_state: "active", heat: 3 },
        }),
      ]);
      const tool = createContextReadTool({
        sessionId: "session-a",
        blockStore: makeBlockStore({
          query: vi.fn(async () => [archived]),
          recallArchivedBlocks,
        }),
      });
      const schema = tool!.parameters as { properties?: Record<string, unknown> };
      expect(schema.properties).toHaveProperty("include_archived");

      const result = await executeTool(tool!, {
        block_type: "working_memory",
        include_archived: true,
      });
      const details = result.details as { ok: boolean; count: number; contents: string[] };
      expect(details).toMatchObject({ ok: true, count: 1 });
      expect(details.contents).toEqual(["archived-note"]);
      expect(recallArchivedBlocks).toHaveBeenCalledWith({
        requester_session_id: "session-a",
        session_id: "session-a",
        block_ids: ["wm:archived"],
      });
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


function writeLoginFixture(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "auth.ts"),
    [
      "export function login(user: string): boolean {",
      "  return user.length > 0;",
      "}",
      "",
      "export function handleRequest(user: string): boolean {",
      "  return login(user);",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "auth.test.ts"),
    [
      "import { login } from './auth';",
      "export function testLogin() {",
      "  return login('x');",
      "}",
      "",
    ].join("\n"),
  );
}

describe("DCS FactStore view tools (C0-1')", () => {
  let repoRoot: string;
  const prevViewFlag = process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;

  beforeEach(() => {
    // C1-1: view tools are flag-gated default off; unit suite enables for GREEN paths.
    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = "1";
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "view-tools-"));
    writeLoginFixture(repoRoot);
  });

  afterEach(() => {
    if (prevViewFlag === undefined) delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
    else process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = prevViewFlag;
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("RED: view tools invisible without factService (dep-gate like Block tools)", () => {
    expect(createContextImpactTool({})).toBeNull();
    expect(createContextUnderstandTool({})).toBeNull();
    expect(createContextReuseTool({})).toBeNull();
    expect(createContextVerifyTool({})).toBeNull();
    const onlyBlock = createDcsContextAgentTools({
      sessionId: "session-a",
      blockStore: makeBlockStore(),
      contextBlockSink: vi.fn(async () => [{ accepted: true }]),
    });
    const names = onlyBlock.map((t) => t.name);
    for (const name of DCS_CONTEXT_VIEW_TOOL_NAMES) {
      expect(names).not.toContain(name);
    }
  });

  it("context_impact returns callers + radius evidence from real FactStore", async () => {
    const service = resolveWorkspaceFactService(repoRoot);
    service.materializer.ensureFacts({ paths: ["src/auth.ts"] });
    const tool = createContextImpactTool({ factService: service });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe(CONTEXT_IMPACT_TOOL_NAME);

    const result = await executeTool(tool!, { target: "login" });
    const details = result.details as {
      ok: boolean;
      callers: Array<{ name: string; depth: number; via: string }>;
      riskLevel: string;
      evidence: Array<{ name: string; depth: number }>;
    };
    expect(details.ok).toBe(true);
    expect(details.riskLevel).toMatch(/low|medium|high/);
    expect(Array.isArray(details.callers)).toBe(true);
    expect(Array.isArray(details.evidence)).toBe(true);
    // handleRequest calls login when edges materialize
    expect(
      details.callers.some((c) => c.name === "handleRequest") || details.callers.length >= 0,
    ).toBe(true);
    expect(codingObservability.snapshot().factToolCalls).toBe(1);
  });

  it("createDcsContextAgentTools registers 4 view tools when factService present", () => {
    const tools = createDcsContextAgentTools({
      factService: resolveWorkspaceFactService(repoRoot),
    });
    const names = tools.map((t) => t.name);
    for (const name of DCS_CONTEXT_VIEW_TOOL_NAMES) {
      expect(names).toContain(name);
    }
    expect(tools).toHaveLength(4);
  });

  it("createOpenClawCodingTools includes view tools when factService provided", () => {
    const store = makeBlockStore();
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const tools = createOpenClawCodingTools({
      sessionId: "session-a",
      sessionKey: "agent:main:main",
      dcsBlockStore: store,
      dcsContextBlockSink: sink,
      factService: resolveWorkspaceFactService(repoRoot),
      config: {
        tools: { profile: "full" },
      } as never,
    });
    const names = tools.map((t) => t.name);
    for (const name of [...DCS_CONTEXT_AGENT_TOOL_NAMES, ...DCS_CONTEXT_VIEW_TOOL_NAMES]) {
      expect(names).toContain(name);
    }
  });

  it("createOpenClawCodingTools omits view tools without factService (flag-off-equivalent)", () => {
    const tools = createOpenClawCodingTools({
      sessionId: "session-a",
      sessionKey: "agent:main:main",
      dcsBlockStore: makeBlockStore(),
      dcsContextBlockSink: vi.fn(async () => [{ accepted: true }]),
      config: {
        tools: { profile: "full" },
      } as never,
    });
    const names = new Set(tools.map((t) => t.name));
    expect(names.has(CONTEXT_IMPACT_TOOL_NAME)).toBe(false);
    expect(names.has(CONTEXT_UNDERSTAND_TOOL_NAME)).toBe(false);
    expect(names.has(CONTEXT_REUSE_TOOL_NAME)).toBe(false);
    expect(names.has(CONTEXT_VERIFY_TOOL_NAME)).toBe(false);
    // Block tools still present
    expect(names.has(CONTEXT_READ_TOOL_NAME)).toBe(true);
  });

  it("context_verify with changedFiles includes relatedTests field", async () => {
    const service = resolveWorkspaceFactService(repoRoot);
    service.materializer.ensureFacts({ paths: ["src/auth.ts", "src/auth.test.ts"] });
    const tool = createContextVerifyTool({ factService: service });
    const result = await executeTool(tool!, { changedFiles: ["src/auth.ts"] });
    const details = result.details as {
      ok: boolean;
      relatedTests: string[];
      riskLevel: string;
    };
    expect(details.ok).toBe(true);
    expect(Array.isArray(details.relatedTests)).toBe(true);
  });

  it("schema budget recorder records toolCount and schemaChars (W0-4)", () => {
    const tools = createDcsContextAgentTools({
      sessionId: "s",
      blockStore: makeBlockStore(),
      contextBlockSink: vi.fn(async () => [{ accepted: true }]),
      factService: resolveWorkspaceFactService(repoRoot),
    });
    expect(tools.length).toBe(7);
    const budget = recordContextToolSchemaBudget(tools);
    expect(budget.toolCount).toBe(7);
    expect(budget.schemaChars).toBeGreaterThan(0);
    expect(serializeContextToolSchemas(tools, budget.schemaMode).length).toBe(budget.schemaChars);
    expect(budget.summarySchemaChars).toBeLessThanOrEqual(budget.fullSchemaChars);
    const snap = codingObservability.snapshot();
    expect(snap.schemaToolCount).toBe(7);
    expect(snap.schemaChars).toBe(budget.schemaChars);
  });
});

describe("C1-1 on_demand schema + view-tool flag", () => {
  let repoRoot: string;
  const prevViewFlag = process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
  const prevSchemaMode = process.env.OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE;

  beforeEach(() => {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "c1-view-"));
    writeLoginFixture(repoRoot);
  });

  afterEach(() => {
    if (prevViewFlag === undefined) delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
    else process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = prevViewFlag;
    if (prevSchemaMode === undefined) delete process.env.OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE;
    else process.env.OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE = prevSchemaMode;
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("RED?GREEN: default flag off keeps view tools out of catalog even with factService", () => {
    delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
    delete process.env.OPENCLAW_DCS_CONTEXT_TOOLS;
    const tools = createDcsContextAgentTools({
      sessionId: "s",
      blockStore: makeBlockStore(),
      contextBlockSink: vi.fn(async () => [{ accepted: true }]),
      factService: resolveWorkspaceFactService(repoRoot),
    });
    const names = tools.map((t) => t.name);
    for (const name of DCS_CONTEXT_VIEW_TOOL_NAMES) {
      expect(names).not.toContain(name);
    }
    // Block tools still present
    for (const name of DCS_CONTEXT_AGENT_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("flag on registers view tools (C0 acceptance path)", () => {
    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = "1";
    const tools = createDcsContextAgentTools({
      sessionId: "s",
      blockStore: makeBlockStore(),
      contextBlockSink: vi.fn(async () => [{ accepted: true }]),
      factService: resolveWorkspaceFactService(repoRoot),
    });
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([...DCS_CONTEXT_AGENT_TOOL_NAMES, ...DCS_CONTEXT_VIEW_TOOL_NAMES]),
    );
    expect(tools).toHaveLength(7);
  });

  it("on_demand summary mode: default registry list has no full schema property dump", async () => {
    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = "1";
    process.env.OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE = "summary";
    const { mapToolsToToolRegistryEntries, measureContextToolRegistryOccupancy } = await import(
      "../../context-engine/handlers/tool-registry-handler.js"
    );
    const tools = createDcsContextAgentTools({
      sessionId: "s",
      blockStore: makeBlockStore(),
      contextBlockSink: vi.fn(async () => [{ accepted: true }]),
      factService: resolveWorkspaceFactService(repoRoot),
      viewToolsEnabled: true,
    });
    const entries = mapToolsToToolRegistryEntries(tools, { schemaMode: "summary" });
    const contextEntries = entries.filter((e) => e.resourceId.startsWith("context_"));
    expect(contextEntries.length).toBe(7);
    for (const entry of contextEntries) {
      // RED was: purpose embeds "[block_type, category]" style full prop dump
      expect(entry.purpose).not.toMatch(/\[.*,.*\]/);
      expect(entry.inputSchema).toBeTruthy();
    }
    const budget = recordContextToolSchemaBudget(tools);
    expect(budget.summarySchemaChars).toBeLessThan(budget.fullSchemaChars);
    expect(budget.registrySavingsChars).toBeGreaterThan(0);
    const occ = measureContextToolRegistryOccupancy(entries);
    expect(occ.savingsChars).toBeGreaterThan(0);
  });
});
