/**
 * C2-4 impact precheck + C2-7 edit-readiness soft gates.
 * Never hard-block; only attach warnings on tool results.
 */
import { analyzeImpact } from "../context-engine/views/impact/impact-view.js";
import type { FactStore } from "../context-engine/factstore/store.js";
import type { WorkspaceFactService } from "../context-engine/factstore/workspace-fact-service.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { toFactRelPath } from "./fact-rel-path.js";

export type SoftWriteGateOptions = {
  workspaceRoot: string;
  factService?: WorkspaceFactService;
  /** C2-4: attach radius warning when target looks high-heat. Default true when factService present. */
  impactPrecheckEnabled?: boolean;
  /** Heat touchCount threshold for "hot" symbols (default 5). */
  hotTouchThreshold?: number;
  /** C2-7: attach readiness warning when ContextPack not answerable. Default true. */
  editReadinessEnabled?: boolean;
  /** Optional precomputed readiness; when omitted, soft-gate is silent for C2-7. */
  editReadiness?: "ready" | "partial" | "not_enough_context";
};

function attachWarning<T extends { details?: unknown }>(result: T, key: string, message: string): T {
  const prev =
    result.details && typeof result.details === "object" && !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  return {
    ...result,
    details: {
      ...prev,
      [key]: message,
    },
  };
}

export function buildImpactPrecheckWarning(params: {
  store: FactStore;
  repoRoot: string;
  targetPath: string;
  hotTouchThreshold?: number;
}): string | undefined {
  const rel = toFactRelPath(params.targetPath, params.repoRoot) ?? params.targetPath;
  const record = params.store.getFileRecord(params.repoRoot, rel);
  const heat = record?.heat.touchCount ?? 0;
  const threshold = params.hotTouchThreshold ?? 5;
  if (heat < threshold) {
    return undefined;
  }
  // High-heat file: sample impact on basename symbol-ish target
  const base = rel.split("/").pop()?.replace(/\.\w+$/, "") ?? rel;
  try {
    const impact = analyzeImpact(params.store, params.repoRoot, base, { depth: 1 });
    const callers = impact.callers?.length ?? 0;
    const risk = impact.riskLevel ?? "unknown";
    return `impact_precheck: high-heat file (touchCount=${heat}) radius callers=${callers} risk=${risk}`;
  } catch {
    return `impact_precheck: high-heat file (touchCount=${heat}) — re-check with context_impact before large edits`;
  }
}

export function wrapToolWithSoftWriteGates(
  tool: AnyAgentTool,
  options: SoftWriteGateOptions,
): AnyAgentTool {
  const impactOn = options.impactPrecheckEnabled !== false && Boolean(options.factService);
  const readinessOn = options.editReadinessEnabled !== false;
  if (!impactOn && !readinessOn) {
    return tool;
  }
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const result = await tool.execute(toolCallId, args, signal, onUpdate);
      let next = result;
      const record = getToolParamsRecord(args);
      const filePath = typeof record?.path === "string" ? record.path : undefined;

      if (impactOn && filePath && options.factService) {
        const warning = buildImpactPrecheckWarning({
          store: options.factService.store,
          repoRoot: options.factService.repoRoot,
          targetPath: filePath,
          hotTouchThreshold: options.hotTouchThreshold,
        });
        if (warning) {
          next = attachWarning(next, "impact_precheck", warning);
        }
      }

      if (readinessOn && options.editReadiness === "not_enough_context") {
        next = attachWarning(
          next,
          "edit_readiness",
          "edit_readiness: not_enough_context — gather context_understand/read before larger writes",
        );
      }
      return next;
    },
  };
}
