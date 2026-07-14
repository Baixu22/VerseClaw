/**
 * DCS Stage 5 agent-facing context tools.
 *
 * Wraps context-engine library functions as real AnyAgentTool instances for
 * createOpenClawCodingTools. Tools are only registered when runtime deps
 * (blockStore / sink / sessionId) are available from the embedded attempt path.
 */
import { Type } from "typebox";
import type {
  BlockStoreApi,
  BlockType,
  ContextBlock,
  ContextBlockSink,
} from "../../context-engine/block.js";
import {
  CONTEXT_READ_BLOCK_TYPES,
  readContext,
} from "../../context-engine/tools/context-read-tool.js";
import { searchContext } from "../../context-engine/tools/context-search-tool.js";
import {
  CONTEXT_WRITE_ROLE_WHITELIST,
  writeContext,
  type WriteOperation,
} from "../../context-engine/tools/context-write-tool.js";
import {
  type AnyAgentTool,
  jsonResult,
  readStringParam,
  asToolParamsRecord,
} from "./common.js";

export const CONTEXT_READ_TOOL_NAME = "context_read";
export const CONTEXT_SEARCH_TOOL_NAME = "context_search";
export const CONTEXT_WRITE_TOOL_NAME = "context_write";

export const DCS_CONTEXT_AGENT_TOOL_NAMES = [
  CONTEXT_READ_TOOL_NAME,
  CONTEXT_SEARCH_TOOL_NAME,
  CONTEXT_WRITE_TOOL_NAME,
] as const;

export type DcsContextAgentToolName = (typeof DCS_CONTEXT_AGENT_TOOL_NAMES)[number];

export type DcsContextAgentToolOptions = {
  sessionId?: string;
  /** Prefer live run session when sandbox session key differs. */
  runSessionKey?: string;
  agentSessionKey?: string;
  blockStore?: Pick<BlockStoreApi, "query" | "queryByEntity">;
  contextBlockSink?: ContextBlockSink;
  /**
   * Agency / orchestration role used for context_write whitelist (ANTI-7).
   * Defaults to "implementer" when unset so coding runs can write notes.
   */
  role?: string;
};

const ContextReadSchema = Type.Object({
  block_type: Type.String({
    description:
      "Context block type to expand (e.g. task_state, tool_registry, experience, notes).",
  }),
  category: Type.Optional(
    Type.String({
      description: "Optional filter for tool_registry entries by category/kind/title.",
    }),
  ),
});

const ContextSearchSchema = Type.Object({
  query: Type.String({
    description:
      "Natural language or entity query. Use 'principles' to search experience Blocks.",
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Max results (1-5). Defaults to 5.",
    }),
  ),
});

const ContextWriteSchema = Type.Object({
  operation: Type.String({
    description: "append | replace | clear",
  }),
  content: Type.Optional(
    Type.String({
      description: "Note content for append/replace. Ignored for clear.",
    }),
  ),
});

function resolveContextSessionId(options: DcsContextAgentToolOptions): string | undefined {
  const candidates = [options.sessionId, options.runSessionKey, options.agentSessionKey];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function resolveContextWriteRole(options: DcsContextAgentToolOptions): string {
  const role = options.role?.trim();
  if (role) {
    return role;
  }
  // Coding agents without an explicit agency role are treated as implementer
  // so notes writes remain available under the Stage 5 whitelist.
  return "implementer";
}

function summarizeBlocks(blocks: ContextBlock[]): Array<{
  block_id: string;
  block_type: string;
  summary: string;
  full_content: string;
  fallback_mode?: string;
}> {
  return blocks.map((block) => ({
    block_id: block.block_id,
    block_type: block.block_type,
    summary: block.summary,
    full_content: block.full_content ?? "",
    ...(block.fallback_mode ? { fallback_mode: block.fallback_mode } : {}),
  }));
}

export function createContextReadTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const sessionId = resolveContextSessionId(options);
  const blockStore = options.blockStore;
  if (!sessionId || !blockStore) {
    return null;
  }
  return {
    label: "Context Read",
    name: CONTEXT_READ_TOOL_NAME,
    displaySummary: "Read full context blocks on demand",
    description:
      "Read the full content of a context block (task_state, tool_registry, experience, notes, etc.). Use when you need details beyond the summary in your system prompt.",
    parameters: ContextReadSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const blockTypeRaw = readStringParam(params, "block_type", { required: true });
      const category = readStringParam(params, "category");
      const result = await readContext({
        block_type: blockTypeRaw as BlockType,
        sessionId,
        blockStore,
        ...(category ? { category } : {}),
      });
      return jsonResult({
        ...result,
        supported_block_types: CONTEXT_READ_BLOCK_TYPES,
      });
    },
  };
}

export function createContextSearchTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const sessionId = resolveContextSessionId(options);
  const blockStore = options.blockStore;
  if (!sessionId || !blockStore) {
    return null;
  }
  return {
    label: "Context Search",
    name: CONTEXT_SEARCH_TOOL_NAME,
    displaySummary: "Search context blocks by entity/query",
    description:
      "Search session context blocks by entities extracted from the query. Use query='principles' for experience Blocks. Returns top-K (<=5).",
    parameters: ContextSearchSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const query = readStringParam(params, "query", { required: true });
      const limitRaw = params.limit;
      const limit =
        typeof limitRaw === "number" && Number.isFinite(limitRaw) ? limitRaw : undefined;
      const blocks = await searchContext({
        query,
        sessionId,
        blockStore: blockStore as BlockStoreApi,
        ...(limit !== undefined ? { limit } : {}),
      });
      return jsonResult({
        ok: true,
        count: blocks.length,
        results: summarizeBlocks(blocks),
      });
    },
  };
}

export function createContextWriteTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const sessionId = resolveContextSessionId(options);
  const sink = options.contextBlockSink;
  const blockStore = options.blockStore;
  if (!sessionId || !sink) {
    return null;
  }
  const role = resolveContextWriteRole(options);
  return {
    label: "Context Write",
    name: CONTEXT_WRITE_TOOL_NAME,
    displaySummary: "Append/replace/clear agent notes",
    description:
      "Update the session notes context block (append, replace, or clear). Only available for planner/architect/implementer roles. Writes always target notes Blocks.",
    parameters: ContextWriteSchema,
    risk: "write",
    writeRiskProfile: {
      kind: "declared_paths",
      writePaths: ["context_blocks/notes"],
    },
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const operationRaw = readStringParam(params, "operation", { required: true });
      const operation = operationRaw as WriteOperation;
      if (operation !== "append" && operation !== "replace" && operation !== "clear") {
        return jsonResult({
          accepted: false,
          reason: `invalid operation '${operationRaw}' (expected append|replace|clear)`,
        });
      }
      const content =
        operation === "clear"
          ? ""
          : (readStringParam(params, "content") ?? "");
      let existingBlock: ContextBlock | undefined;
      if (blockStore && operation !== "replace") {
        const existing = await blockStore.query({
          requester_session_id: sessionId,
          session_id: sessionId,
          block_types: ["notes"],
          limit: 1,
        });
        existingBlock = existing[0];
      } else if (blockStore && operation === "replace") {
        const existing = await blockStore.query({
          requester_session_id: sessionId,
          session_id: sessionId,
          block_types: ["notes"],
          limit: 1,
        });
        existingBlock = existing[0];
      }
      const result = await writeContext({
        operation,
        content,
        role,
        sessionId,
        contextBlockSink: sink,
        ...(existingBlock ? { existingBlock } : {}),
      });
      return jsonResult({
        ...result,
        role,
        whitelist: CONTEXT_WRITE_ROLE_WHITELIST,
      });
    },
  };
}

/** Build the three DCS context tools that have required deps; omit missing ones. */
export function createDcsContextAgentTools(options: DcsContextAgentToolOptions): AnyAgentTool[] {
  return [
    createContextReadTool(options),
    createContextSearchTool(options),
    createContextWriteTool(options),
  ].filter((tool): tool is AnyAgentTool => tool !== null);
}