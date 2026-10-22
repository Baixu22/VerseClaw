/**
 * DCS Stage 5 agent-facing context tools.
 *
 * Wraps context-engine library functions as real AnyAgentTool instances for
 * createOpenClawCodingTools. Tools are only registered when runtime deps
 * (blockStore / sink / sessionId for Block tools; FactService for Fact views)
 * are available from the embedded attempt path.
 *
 * C0-1': four FactStore view tools (understand/impact/reuse/verify) share this
 * same shell factory as the original three BlockStore tools.
 */
import { createHash } from "node:crypto";
import { Type } from "typebox";
import { normalizeArchiveHandle } from "../../../../shared/types/context-item.js";
import {
  assertPermissionEffectOwnerCheckpoint,
  permissionEffectBindingFor,
} from "../../../../shared/permission-effect-contract.js";
import { verifyContextArchiveHandle } from "../../context-engine/registry/context-item-registry.js";
import type {
  BlockStoreApi,
  BlockType,
  ContextBlock,
  ContextBlockSink,
} from "../../context-engine/block.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import {
  isDcsContextViewToolsEnabled,
  resolveContextToolSchemaMode,
  type ContextToolSchemaMode,
} from "../../context-engine/dcs-context-tools-flags.js";
import {
  contextToolOneLineSummary,
  isContextAgentToolName,
} from "../../context-engine/coding-tool-navigation.js";
import {
  mapToolsToToolRegistryEntries,
  measureContextToolRegistryOccupancy,
} from "../../context-engine/handlers/tool-registry-handler.js";
import type { WorkspaceFactService } from "../../context-engine/factstore/workspace-fact-service.js";
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
import { analyzeImpact } from "../../context-engine/views/impact/impact-view.js";
import {
  buildContextPack,
  DEFAULT_PACK_BUDGET_CHARS,
} from "../../context-engine/views/pack/context-pack-view.js";
import { buildQueryContext } from "../../context-engine/views/retrieval/query-context.js";
import { retrieveHybrid } from "../../context-engine/views/retrieval/hybrid-retriever.js";
import { buildReuseCandidateReport } from "../../context-engine/views/reuse-detector.js";
import { reviewDiff } from "../../context-engine/views/verify/review-diff-view.js";
import {
  type AnyAgentTool,
  jsonResult,
  readStringParam,
  asToolParamsRecord,
} from "./common.js";

export const CONTEXT_READ_TOOL_NAME = "context_read";
export const CONTEXT_ARCHIVE_RECALL_TOOL_NAME = "context_archive_recall";
export const CONTEXT_SEARCH_TOOL_NAME = "context_search";
export const CONTEXT_WRITE_TOOL_NAME = "context_write";
export const CONTEXT_UNDERSTAND_TOOL_NAME = "context_understand";
export const CONTEXT_IMPACT_TOOL_NAME = "context_impact";
export const CONTEXT_REUSE_TOOL_NAME = "context_reuse";
export const CONTEXT_VERIFY_TOOL_NAME = "context_verify";

export const DCS_CONTEXT_AGENT_TOOL_NAMES = [
  CONTEXT_READ_TOOL_NAME,
  CONTEXT_ARCHIVE_RECALL_TOOL_NAME,
  CONTEXT_SEARCH_TOOL_NAME,
  CONTEXT_WRITE_TOOL_NAME,
] as const;

export const DCS_CONTEXT_VIEW_TOOL_NAMES = [
  CONTEXT_UNDERSTAND_TOOL_NAME,
  CONTEXT_IMPACT_TOOL_NAME,
  CONTEXT_REUSE_TOOL_NAME,
  CONTEXT_VERIFY_TOOL_NAME,
] as const;

export const DCS_ALL_CONTEXT_TOOL_NAMES = [
  ...DCS_CONTEXT_AGENT_TOOL_NAMES,
  ...DCS_CONTEXT_VIEW_TOOL_NAMES,
] as const;

export type DcsContextAgentToolName = (typeof DCS_CONTEXT_AGENT_TOOL_NAMES)[number];
export type DcsContextViewToolName = (typeof DCS_CONTEXT_VIEW_TOOL_NAMES)[number];

export type DcsContextAgentToolOptions = {
  sessionId?: string;
  /** Prefer live run session when sandbox session key differs. */
  runSessionKey?: string;
  agentSessionKey?: string;
  /** Workspace bound to the context write effect. */
  workspaceRoot?: string;
  blockStore?: Pick<BlockStoreApi, "query" | "queryByEntity" | "recallArchivedBlocks">;
  contextBlockSink?: ContextBlockSink;
  /**
   * Agency / orchestration role used for context_write whitelist (ANTI-7).
   * Defaults to "implementer" when unset so coding runs can write notes.
   */
  role?: string;
  /**
   * C0-3: shared per-workspace FactStore + Materializer for the four view tools.
   * When omitted, view tools are absent (same dep-gate pattern as Block tools).
   */
  factService?: WorkspaceFactService;
  /**
   * C1-1 / C0-4 kill-switch for the four Fact view tools.
   * Default resolves from env (OFF/shadow). Explicit true/false overrides env.
   */
  viewToolsEnabled?: boolean;
  /** Optional ContextPack budget override (W0-4 / addendum 6). */
  budgetChars?: number;
  /**
   * Session-local files already read this turn (optional).
   * Used by context_understand when no activeFiles arg is provided.
   */
  activeFiles?: string[];
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
  include_archived: Type.Optional(
    Type.Boolean({
      description:
        "Explicitly recall archived blocks: restore them to active, increment heat, persist, and return them. Defaults to false.",
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

const ContextImpactSchema = Type.Object({
  target: Type.String({
    description: "Symbol name, path:symbol, or file path.",
  }),
  depth: Type.Optional(
    Type.Number({
      description: "Caller/callee chain depth (default 2).",
    }),
  ),
});

const ContextUnderstandSchema = Type.Object({
  query: Type.String({
    description: "Goal or natural-language question for a ContextPack.",
  }),
  activeFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional repo-relative paths to materialize first.",
    }),
  ),
  budgetChars: Type.Optional(
    Type.Number({
      description: "Character budget for the pack (default from W0-4).",
    }),
  ),
});

const ContextReuseSchema = Type.Object({
  query: Type.String({
    description: "Capability or helper to look for before writing new code.",
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Max reuse candidates (default 8).",
    }),
  ),
});

const ContextVerifySchema = Type.Object({
  diff: Type.Optional(
    Type.String({
      description: "Unified git diff to review.",
    }),
  ),
  changedFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Repo-relative changed file paths (alternative to diff).",
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

function requireFactService(options: DcsContextAgentToolOptions): WorkspaceFactService | null {
  return options.factService ?? null;
}

function resolveViewToolsEnabled(options: DcsContextAgentToolOptions): boolean {
  if (typeof options.viewToolsEnabled === "boolean") {
    return options.viewToolsEnabled;
  }
  return isDcsContextViewToolsEnabled();
}

function requireViewFactService(
  options: DcsContextAgentToolOptions,
): WorkspaceFactService | null {
  if (!resolveViewToolsEnabled(options)) {
    return null;
  }
  return requireFactService(options);
}

function flushService(service: WorkspaceFactService): void {
  service.materializer.flushTouched();
}

function recordViewCall(toolName: string): void {
  codingObservability.recordFactToolCall(toolName);
}

const ContextArchiveRecallSchema = Type.Object({
  archive_uri: Type.String({ description: "Archive handle URI from a masked observation placeholder." }),
  checksum: Type.String({ description: "Archive handle checksum from the placeholder." }),
  byte_length: Type.Optional(Type.Integer({ minimum: 0 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  max_chars: Type.Optional(Type.Integer({ minimum: 1, maximum: 20_000 })),
});

const CONTEXT_ARCHIVE_RECALL_DEFAULT_MAX_CHARS = 12_000;

function archivePayloadToText(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

export function createContextArchiveRecallTool(
  options: DcsContextAgentToolOptions,
): AnyAgentTool | null {
  const sessionId = resolveContextSessionId(options);
  if (!sessionId) {
    return null;
  }
  return {
    label: "Context Archive Recall",
    name: CONTEXT_ARCHIVE_RECALL_TOOL_NAME,
    displaySummary: "Read a bounded excerpt from a masked observation archive",
    description:
      "Read only an archive handle emitted by Context observation masking. The handle must belong to the current session; output is bounded and can be paged with offset.",
    parameters: ContextArchiveRecallSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const uri = readStringParam(params, "archive_uri", { required: true })!;
      const checksum = readStringParam(params, "checksum", { required: true })!;
      const byteLengthRaw = params.byte_length;
      const byteLength =
        typeof byteLengthRaw === "number" && Number.isSafeInteger(byteLengthRaw) && byteLengthRaw >= 0
          ? byteLengthRaw
          : 0;
      let handle;
      try {
        handle = normalizeArchiveHandle({ uri, checksum, byteLength });
      } catch (error) {
        return jsonResult({
          ok: false,
          diagnostics: [{ code: "invalid_handle", message: error instanceof Error ? error.message : String(error) }],
        });
      }
      const verified = await verifyContextArchiveHandle(handle);
      if (!verified.ok) {
        return jsonResult({
          ok: false,
          diagnostics: [{ code: verified.reason, message: `Archive recall failed: ${verified.reason}` }],
        });
      }
      const ownerSessionId = verified.handle?.source?.sessionId;
      if (!ownerSessionId || ownerSessionId !== sessionId) {
        return jsonResult({
          ok: false,
          diagnostics: [{ code: "session_mismatch", message: "Archive handle belongs to another session." }],
        });
      }
      const offsetRaw = params.offset;
      const offset =
        typeof offsetRaw === "number" && Number.isSafeInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
      const maxCharsRaw = params.max_chars;
      const maxChars =
        typeof maxCharsRaw === "number" && Number.isSafeInteger(maxCharsRaw) && maxCharsRaw > 0
          ? Math.min(maxCharsRaw, 20_000)
          : CONTEXT_ARCHIVE_RECALL_DEFAULT_MAX_CHARS;
      const text = archivePayloadToText(verified.payload);
      const content = text.slice(offset, offset + maxChars);
      return jsonResult({
        ok: true,
        archive_uri: handle.uri,
        checksum: handle.checksum,
        content,
        offset,
        max_chars: maxChars,
        char_count: text.length,
        byte_count: Buffer.byteLength(text, "utf8"),
        truncated: offset + content.length < text.length,
      });
    },
  };
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
      "Read the full content of a context block (task_state, tool_registry, experience, notes, etc.). Set include_archived=true to explicitly recall archived blocks back to active memory.",
    parameters: ContextReadSchema,
    // Tool risk metadata classifies filesystem writes. The explicit
    // include_archived path performs an in-store lifecycle touch in the
    // existing BlockStore authority; default context_read remains read-only.
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const blockTypeRaw = readStringParam(params, "block_type", { required: true });
      const category = readStringParam(params, "category");
      const includeArchived = params.include_archived === true;
      const result = await readContext({
        block_type: blockTypeRaw as BlockType,
        sessionId,
        blockStore,
        ...(category ? { category } : {}),
        ...(includeArchived ? { includeArchived: true } : {}),
      });
      // FP-P1-04 read段: hit count must be observable. Previously only the 4
      // view tools were instrumented, so a Block read was invisible.
      codingObservability.recordFactToolCall(CONTEXT_READ_TOOL_NAME);
      codingObservability.recordFactStoreHit(result.ok && result.count > 0);
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
      // FP-P1-04 read段: a search that finds nothing must be a recorded miss,
      // not an unobserved no-op.
      codingObservability.recordFactToolCall(CONTEXT_SEARCH_TOOL_NAME);
      codingObservability.recordFactStoreHit(blocks.length > 0);
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
    execute: async (toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const operationRaw = readStringParam(params, "operation", { required: true });
      const operation = operationRaw as WriteOperation;
      if (operation !== "append" && operation !== "replace" && operation !== "clear") {
        return jsonResult({
          accepted: false,
          reason: `invalid operation '${operationRaw}' (expected append|replace|clear)`,
        });
      }
      if (!(CONTEXT_WRITE_ROLE_WHITELIST as readonly string[]).includes(role)) {
        return jsonResult({
          accepted: false,
          reason: `role '${role}' is not in context_write whitelist`,
        });
      }
      const content =
        operation === "clear"
          ? ""
          : (readStringParam(params, "content") ?? "");
      const nowMs = Date.now();
      const workspaceId = options.workspaceRoot?.trim() || process.cwd();
      const effectDigest = createHash("sha256")
        .update(`${sessionId}\0${role}\0${operation}\0${toolCallId}\0${content}`)
        .digest("hex");
      const policyDigest = `sha256:${createHash("sha256")
        .update(`context-write-policy:v1\0${role}\0${CONTEXT_WRITE_ROLE_WHITELIST.join(",")}`)
        .digest("hex")}`;
      const binding = permissionEffectBindingFor("fact-tools");
      if (!binding) {
        return jsonResult({ accepted: false, reason: "permission-effect-binding-missing" });
      }
      try {
        assertPermissionEffectOwnerCheckpoint({
          componentId: "fact-tools",
          subject: {
            sessionKey: options.runSessionKey?.trim() || options.agentSessionKey?.trim() || sessionId,
            runId: sessionId,
            attemptIndex: 0,
            modelCallIndex: 0,
            actorKind: "principal",
            workspaceId,
            taskBranchId: `context:${sessionId}`,
          },
          request: {
            requestId: `context-write-${effectDigest.slice(0, 24)}`,
            action: operation,
            resource: `context-block:${sessionId}:notes`,
            purpose: "append or replace agent notes under the context_write role whitelist",
            idempotencyKey: `context-write-${effectDigest.slice(0, 32)}`,
          },
          authorityOwner: binding.finalAuthorityOwner,
          decisionRef: `context-decision-${effectDigest.slice(0, 24)}`,
          policyDigest,
          issuedAtMs: nowMs,
          expiresAtMs: nowMs + 30_000,
          nowMs,
          revocationEpoch: "context-write-revocation:v1",
          policyEpoch: policyDigest,
          catalogEpoch: "dcs-context-tools:v1",
        });
      } catch (error) {
        return jsonResult({
          accepted: false,
          reason: error instanceof Error ? error.message : "permission-effect-check-failed",
        });
      }
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

export function createContextImpactTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const service = requireViewFactService(options);
  if (!service) {
    return null;
  }
  return {
    label: "Context Impact",
    name: CONTEXT_IMPACT_TOOL_NAME,
    displaySummary: "Analyze callers/callees and blast radius for a symbol or file",
    description:
      "Analyze impact of a symbol or file path: matched symbols, callers, callees, impacted files, and risk level. Prefer this over ad-hoc grep for navigation questions.",
    parameters: ContextImpactSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      recordViewCall(CONTEXT_IMPACT_TOOL_NAME);
      const params = asToolParamsRecord(args);
      const target = readStringParam(params, "target", { required: true })!;
      const depth =
        typeof params.depth === "number" && Number.isFinite(params.depth)
          ? params.depth
          : undefined;
      flushService(service);
      const analysis = analyzeImpact(
        service.store,
        service.repoRoot,
        target,
        depth !== undefined ? { depth } : {},
      );
      const hasHits = analysis.matchedSymbols.length > 0 || analysis.callers.length > 0;
      codingObservability.recordFactStoreHit(hasHits);
      return jsonResult({
        ok: true,
        target: analysis.target,
        riskLevel: analysis.riskLevel,
        matchedSymbols: analysis.matchedSymbols.map((symbol) => ({
          name: symbol.name,
          filePath: symbol.filePath,
          kind: symbol.kind,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
        })),
        callers: analysis.callers,
        callees: analysis.callees,
        impactedFiles: analysis.impactedFiles,
        // Radius evidence for C0-1' acceptance: callers with depth + via.
        evidence: analysis.callers.slice(0, 8).map((caller) => ({
          name: caller.name,
          filePath: caller.filePath,
          depth: caller.depth,
          via: caller.via,
        })),
      });
    },
  };
}

export function createContextUnderstandTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const service = requireViewFactService(options);
  if (!service) {
    return null;
  }
  return {
    label: "Context Understand",
    name: CONTEXT_UNDERSTAND_TOOL_NAME,
    displaySummary: "Build a ContextPack for a coding goal",
    description:
      "Build a structured ContextPack (answerable snippets, edit readiness) for a goal or question. Prefer this when exploring where a feature lives.",
    parameters: ContextUnderstandSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      recordViewCall(CONTEXT_UNDERSTAND_TOOL_NAME);
      const params = asToolParamsRecord(args);
      const query = readStringParam(params, "query", { required: true })!;
      const activeFromArgs = Array.isArray(params.activeFiles)
        ? params.activeFiles.filter((entry): entry is string => typeof entry === "string")
        : undefined;
      const activeFiles = activeFromArgs ?? options.activeFiles ?? [];
      const budgetChars =
        typeof params.budgetChars === "number" && Number.isFinite(params.budgetChars)
          ? params.budgetChars
          : (options.budgetChars ?? DEFAULT_PACK_BUDGET_CHARS);
      flushService(service);
      const pack = await buildContextPack(service.store, service.materializer, {
        query,
        activeFiles,
        budgetChars,
      });
      codingObservability.recordFactStoreHit(Boolean(pack.answerable || (pack.snippets?.length ?? 0) > 0));
      return jsonResult({
        ok: true,
        answerable: pack.answerable,
        confidence: pack.confidence,
        editReadiness: pack.editReadiness,
        mode: pack.mode,
        projectId: pack.projectId,
        snippets: pack.snippets?.slice(0, 12) ?? [],
        brief: pack.brief,
        missingEvidence: pack.missingEvidence,
        nextQueries: pack.nextQueries,
      });
    },
  };
}

export function createContextReuseTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const service = requireViewFactService(options);
  if (!service) {
    return null;
  }
  return {
    label: "Context Reuse",
    name: CONTEXT_REUSE_TOOL_NAME,
    displaySummary: "Find existing helpers before writing new code",
    description:
      "Detect reuse candidates (existing symbols/helpers) for a capability query. Use before inventing a new utility.",
    parameters: ContextReuseSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      recordViewCall(CONTEXT_REUSE_TOOL_NAME);
      const params = asToolParamsRecord(args);
      const query = readStringParam(params, "query", { required: true })!;
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? params.limit
          : undefined;
      flushService(service);
      const repoRoot = service.repoRoot;
      const retrieval = retrieveHybrid(service.store, repoRoot, buildQueryContext(query), {
        limit: 24,
      });
      const hitFiles = [...new Set(retrieval.hits.map((hit) => hit.chunk.filePath))];
      const symbols = hitFiles.flatMap((filePath) =>
        service.store.getSymbolsByFile(repoRoot, filePath),
      );
      const chunks = hitFiles.flatMap((filePath) =>
        service.store.getChunksByFile(repoRoot, filePath),
      );
      const edges = [
        ...service.store.getEdgesByKind(repoRoot, "calls"),
        ...service.store.getEdgesByKind(repoRoot, "imports"),
        ...service.store.getEdgesByKind(repoRoot, "tested_by"),
      ];
      const owners = hitFiles.slice(0, 5).map((filePath) => ({
        filePath,
        score: 1,
        reasons: ["retrieval hit"],
        symbols: service.store
          .getSymbolsByFile(repoRoot, filePath)
          .filter((symbol) => symbol.kind !== "file"),
      }));
      const report = buildReuseCandidateReport({
        query,
        hits: retrieval.hits,
        owners,
        symbols,
        edges,
        chunks,
        ...(limit !== undefined ? { limit } : {}),
      });
      codingObservability.recordFactStoreHit(report.candidates.length > 0);
      return jsonResult({
        ok: true,
        query: report.query,
        decision: report.decision,
        confidence: report.confidence,
        duplicateRisk: report.duplicateRisk,
        candidates: report.candidates,
        reuseGuard: report.reuseGuard,
        missingEvidence: report.missingEvidence,
        nextQueries: report.nextQueries,
      });
    },
  };
}

export function createContextVerifyTool(options: DcsContextAgentToolOptions): AnyAgentTool | null {
  const service = requireViewFactService(options);
  if (!service) {
    return null;
  }
  return {
    label: "Context Verify",
    name: CONTEXT_VERIFY_TOOL_NAME,
    displaySummary: "Review a diff for related tests and blast radius",
    description:
      "Review changed files or a unified diff for related tests, impacted files, risk, and findings.",
    parameters: ContextVerifySchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      recordViewCall(CONTEXT_VERIFY_TOOL_NAME);
      const params = asToolParamsRecord(args);
      const diff =
        typeof params.diff === "string" && params.diff.trim() ? params.diff : undefined;
      const changedFiles = Array.isArray(params.changedFiles)
        ? params.changedFiles.filter((entry): entry is string => typeof entry === "string")
        : undefined;
      if (!diff && (!changedFiles || changedFiles.length === 0)) {
        return jsonResult({
          ok: false,
          reason: "Provide diff or changedFiles.",
        });
      }
      flushService(service);
      const review = reviewDiff(service.store, service.repoRoot, {
        ...(diff ? { diff } : {}),
        ...(changedFiles ? { changedFiles } : {}),
      });
      codingObservability.recordFactStoreHit(review.changedFiles.length > 0);
      return jsonResult({
        ok: true,
        changedFiles: review.changedFiles,
        relatedTests: review.relatedTests,
        riskLevel: review.riskLevel,
        findings: review.findings,
        impactedFiles: review.impactedFiles,
      });
    },
  };
}

/**
 * Serialize tool schemas for W0-4 / addendum 6 character-budget assertions.
 */
export function serializeContextToolSchemas(
  tools: AnyAgentTool[],
  mode: ContextToolSchemaMode = "full",
): string {
  return tools
    .map((tool) => {
      if (mode === "summary" && isContextAgentToolName(tool.name)) {
        return JSON.stringify({
          name: tool.name,
          description: contextToolOneLineSummary(tool.name, tool.description ?? ""),
        });
      }
      return JSON.stringify({ name: tool.name, parameters: tool.parameters });
    })
    .join("\n");
}

/**
 * Record schema occupancy for the seven context_* tools (or the active subset).
 * Returns { toolCount, schemaChars } for gate reports.
 */
export function recordContextToolSchemaBudget(tools: AnyAgentTool[]): {
  toolCount: number;
  schemaChars: number;
  fullSchemaChars: number;
  summarySchemaChars: number;
  registrySummaryChars: number;
  registryFullSchemaChars: number;
  registrySavingsChars: number;
  schemaMode: ContextToolSchemaMode;
} {
  const schemaMode = resolveContextToolSchemaMode();
  const fullSerialized = serializeContextToolSchemas(tools, "full");
  const summarySerialized = serializeContextToolSchemas(tools, "summary");
  const toolCount = tools.length;
  const fullSchemaChars = fullSerialized.length;
  const summarySchemaChars = summarySerialized.length;
  const schemaChars = schemaMode === "summary" ? summarySchemaChars : fullSchemaChars;
  codingObservability.recordSchemaOccupancy(toolCount, schemaChars);
  const registryEntries = mapToolsToToolRegistryEntries(tools, { schemaMode: "summary" });
  const registry = measureContextToolRegistryOccupancy(registryEntries);
  return {
    toolCount,
    schemaChars,
    fullSchemaChars,
    summarySchemaChars,
    registrySummaryChars: registry.summaryChars,
    registryFullSchemaChars: registry.fullSchemaChars,
    registrySavingsChars: registry.savingsChars,
    schemaMode,
  };
}

/** Build DCS context tools that have required deps; omit missing ones. */
export function createDcsContextAgentTools(options: DcsContextAgentToolOptions): AnyAgentTool[] {
  const tools = [
    createContextReadTool(options),
    createContextArchiveRecallTool(options),
    createContextSearchTool(options),
    createContextWriteTool(options),
    createContextUnderstandTool(options),
    createContextImpactTool(options),
    createContextReuseTool(options),
    createContextVerifyTool(options),
  ].filter((tool): tool is AnyAgentTool => tool !== null);
  // Keep W0-4 counter warm whenever the shell builds a non-empty catalog.
  if (tools.length > 0) {
    recordContextToolSchemaBudget(tools);
  }
  return tools;
}
