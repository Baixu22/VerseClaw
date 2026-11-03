/**
 * context_fold: one tool-dense child task -> one bounded ContextFoldResult.
 *
 * The child is created through the existing sessions_spawn tool with isolated
 * context and an explicit tool allowlist. The parent receives only a spawned
 * acknowledgement and a fold id; the child's raw completion is intercepted by
 * the registry/steering projection before it can reach the parent prompt.
 */
import { Type } from "typebox";
import {
  ContextFoldingValidationError,
  type ContextHandle,
  type ContextRequesterIdentity,
} from "../../../../shared/types/context-folding.js";
import {
  bindContextFoldChildHandles,
  contextFoldDeliveryId,
  prepareContextFold,
  type ContextFoldPrepareResult,
} from "../../context-engine/context-folding/fold.js";
import { isContextFoldingEnabled } from "../../context-engine/context-folding/flags.js";
import { updateSubagentRunContextFoldMetadata } from "../subagent-registry.js";
import type { AnyAgentTool } from "./common.js";
import { asToolParamsRecord, jsonResult, readStringParam } from "./common.js";
import { createSessionsSpawnTool } from "./sessions-spawn-tool.js";

export const CONTEXT_FOLD_TOOL_NAME = "context_fold";

type SpawnToolLike = Pick<AnyAgentTool, "execute">;
type SpawnedDetails = {
  status?: string;
  childSessionKey?: string;
  runId?: string;
  error?: string;
};

export type ContextFoldToolOptions = {
  sessionId?: string;
  workspaceRoot?: string;
  runSessionKey?: string;
  parentRunId?: string;
  config?: unknown;
  contextFoldingEnabled?: boolean;
  contextFoldingNow?: () => string;
  blockStore?: Pick<import("../../context-engine/block.js").BlockStoreApi, "query" | "queryByEntity" | "recallArchivedBlocks">;
  factService?: unknown;
  role?: string;
  budgetChars?: number;
  spawnTool?: SpawnToolLike;
  onSpawn?: (input: {
    task: string;
    label: string;
    childSessionKey?: string;
    childRunId?: string;
    request: ContextFoldPrepareResult["request"];
    childHandles: ContextHandle[];
    deliveryId: string;
  }) => void;
  /** Testable registry hook; production uses the real run tag. */
  tagRun?: (runId: string, metadata: NonNullable<import("../subagent-registry.types.js").SubagentRunRecord["contextFold"]>) => boolean;
};

const ContextFoldSchema = Type.Object({
  request: Type.Record(Type.String(), Type.Unknown(), {
    description: "ContextFoldRequest/v1 from the parent session.",
  }),
  label: Type.Optional(Type.String({ description: "Stable short label for the child run." })),
});

function readSpawned(details: unknown): SpawnedDetails {
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as SpawnedDetails)
    : {};
}

function foldEnabled(options: ContextFoldToolOptions): boolean {
  return typeof options.contextFoldingEnabled === "boolean"
    ? options.contextFoldingEnabled
    : isContextFoldingEnabled(options.config);
}

function parentIdentity(options: ContextFoldToolOptions, sessionId: string): ContextRequesterIdentity {
  return {
    workspaceId: (options.workspaceRoot?.trim() || process.cwd()) as ContextRequesterIdentity["workspaceId"],
    sessionId,
    ...(options.runSessionKey?.trim() ? { sessionKey: options.runSessionKey.trim() as ContextRequesterIdentity["sessionKey"] } : {}),
    actor: "parent",
    depth: 0,
  };
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ContextFoldingValidationError) {
    return { ok: false, tool: CONTEXT_FOLD_TOOL_NAME, diagnostics: error.issues };
  }
  return { ok: false, tool: CONTEXT_FOLD_TOOL_NAME, diagnostics: [{ code: "invalid_request", message: error instanceof Error ? error.message : String(error) }] };
}

export function createContextFoldTool(options: ContextFoldToolOptions): AnyAgentTool | null {
  const sessionId = options.sessionId?.trim();
  if (!sessionId || !foldEnabled(options)) return null;
  const spawnTool = options.spawnTool ?? createSessionsSpawnTool({
    agentSessionKey: options.runSessionKey,
    config: options.config as never,
    workspaceDir: options.workspaceRoot,
  });
  return {
    label: "Context Fold",
    name: CONTEXT_FOLD_TOOL_NAME,
    displaySummary: "Delegate one bounded, tool-dense subtask and return only a FoldedResult",
    description:
      "Create one isolated child with explicit handles, tools, scope and budget. The parent receives a spawned fold id; the child's raw transcript and tool output never enter the parent. Use context_expand for later detail.",
    parameters: ContextFoldSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      try {
        const params = asToolParamsRecord(args);
        if (!params.request || typeof params.request !== "object" || Array.isArray(params.request)) {
          return jsonResult({ ok: false, tool: CONTEXT_FOLD_TOOL_NAME, diagnostics: [{ code: "invalid_request", message: "request is required" }] });
        }
        const prepared = prepareContextFold({
          request: params.request,
          parent: parentIdentity(options, sessionId),
          ...(options.parentRunId?.trim() ? { parentRunId: options.parentRunId.trim() } : {}),
        });
        const label = readStringParam(params, "label") || `context-fold-${prepared.request.foldId.slice(4, 12)}`;
        const spawnDetails = readSpawned((await spawnTool.execute("context-fold-spawn", {
          task: prepared.childTask,
          label,
          runtime: "subagent",
          mode: "run",
          cleanup: "keep",
          context: "isolated",
          lightContext: true,
          expectsCompletionMessage: true,
        })).details);
        if (spawnDetails.status !== "accepted") {
          return jsonResult({
            ok: false,
            tool: CONTEXT_FOLD_TOOL_NAME,
            status: spawnDetails.status ?? "error",
            diagnostics: [{ code: "invalid_request", message: spawnDetails.error || "sessions_spawn did not accept the child" }],
          });
        }
        const childSessionKey = spawnDetails.childSessionKey?.trim();
        const childRunId = spawnDetails.runId?.trim();
        if (!childSessionKey || !childRunId) {
          return jsonResult({
            ok: false,
            tool: CONTEXT_FOLD_TOOL_NAME,
            diagnostics: [{ code: "child_identity_mismatch", message: "sessions_spawn accepted the child without childSessionKey/runId" }],
          });
        }
        const childHandles = bindContextFoldChildHandles({
          request: prepared.request,
          childSessionId: childSessionKey,
          childSessionKey,
        });
        const deliveryId = contextFoldDeliveryId({ foldId: prepared.request.foldId, childRunId });
        const foldMetadata = {
          foldId: prepared.request.foldId,
          deliveryId,
          maxResultChars: prepared.request.maxResultChars,
          childHandles: childHandles.map((handle) => ({
            handleId: handle.handleId,
            resourceId: handle.resourceId,
            selector: JSON.stringify(handle.selector),
            checksum: handle.checksum,
            kind: "excerpt" as const,
            ...(handle.label ? { label: handle.label } : {}),
          })),
        };
        const tagged = (options.tagRun ?? updateSubagentRunContextFoldMetadata)(childRunId, foldMetadata);
        if (!tagged) {
          return jsonResult({
            ok: false,
            tool: CONTEXT_FOLD_TOOL_NAME,
            diagnostics: [{ code: "child_identity_mismatch", message: "spawned child was not found in the registry" }],
          });
        }
        options.onSpawn?.({
          task: prepared.childTask,
          label,
          childSessionKey,
          childRunId,
          request: prepared.request,
          childHandles,
          deliveryId,
        });
        return jsonResult({
          ok: true,
          tool: CONTEXT_FOLD_TOOL_NAME,
          status: "accepted",
          foldId: prepared.request.foldId,
          childSessionKey,
          childRunId,
          deliveryId,
          event: {
            type: "context_fold",
            foldId: prepared.request.foldId,
            childSessionKey,
            childRunId,
            deliveryId,
            at: options.contextFoldingNow ? options.contextFoldingNow() : new Date().toISOString(),
          },
          note: "The child result must arrive as a validated ContextFoldResult; use context_expand for further detail.",
        });
      } catch (error) {
        return jsonResult(errorPayload(error));
      }
    },
  };
}
