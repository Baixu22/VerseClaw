/**
 * C2-10: write/edit destructive tier classification (Claude Code reversibility weighting).
 * read exempt < edit/write (journal lowers annoyance) < apply_patch Delete/Move / large overwrite.
 */
import { areDiagnosticsEnabledForProcess } from "../infra/diagnostic-events.js";
import { diagnosticLogger } from "../logging/diagnostic-runtime.js";
import { codingObservability } from "../context-engine/coding-observability.js";
import { extractPatchTargetPaths } from "./tools/write-journal.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { AnyAgentTool } from "./agent-tools.types.js";

export type DestructiveTier = "exempt" | "reversible" | "destructive";

export type DestructiveClassification = {
  tier: DestructiveTier;
  reason: string;
  requiresApproval: boolean;
};

const LARGE_OVERWRITE_CHARS = 50_000;

export function classifyWriteDestructiveTier(params: {
  toolName: string;
  args?: unknown;
  journalEnabled?: boolean;
}): DestructiveClassification {
  const name = params.toolName;
  if (name === "read" || name === "grep" || name === "context_read" || name === "context_impact") {
    return { tier: "exempt", reason: "readonly", requiresApproval: false };
  }

  const record = getToolParamsRecord(params.args) ?? {};

  if (name === "apply_patch") {
    const input = typeof record.input === "string" ? record.input : "";
    if (/\*\*\*\s+Delete\s+File:/i.test(input) || /\*\*\*\s+Move\s+File:/i.test(input)) {
      return {
        tier: "destructive",
        reason: "apply_patch_delete_or_move",
        requiresApproval: true,
      };
    }
    // Multi-file patches are elevated
    const paths = extractPatchTargetPaths(input);
    if (paths.length >= 5) {
      return {
        tier: "destructive",
        reason: "apply_patch_large_blast",
        requiresApproval: true,
      };
    }
    return {
      tier: "destructive",
      reason: "apply_patch_default",
      requiresApproval: true,
    };
  }

  if (name === "write") {
    const content = typeof record.content === "string" ? record.content : "";
    if (content.length >= LARGE_OVERWRITE_CHARS) {
      return {
        tier: "destructive",
        reason: "large_overwrite",
        requiresApproval: true,
      };
    }
    if (params.journalEnabled !== false) {
      return {
        tier: "reversible",
        reason: "write_with_journal",
        requiresApproval: false,
      };
    }
    return {
      tier: "reversible",
      reason: "write_no_journal",
      requiresApproval: true,
    };
  }

  if (name === "edit") {
    if (params.journalEnabled !== false) {
      return {
        tier: "reversible",
        reason: "edit_with_journal",
        requiresApproval: false,
      };
    }
    return {
      tier: "reversible",
      reason: "edit_no_journal",
      requiresApproval: true,
    };
  }

  if (name === "undo_write") {
    return { tier: "reversible", reason: "undo", requiresApproval: false };
  }

  return { tier: "reversible", reason: "default", requiresApproval: false };
}

/**
 * Wrap a tool so execute records approval prompt rate metrics and attaches tier details.
 * Does not hard-block; approval surface is declarative for host policy.
 */
export function wrapToolWithDestructiveTier(
  tool: AnyAgentTool,
  options?: { journalEnabled?: boolean; approvalRateDiagnosticsEnabled?: boolean },
): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const classification = classifyWriteDestructiveTier({
        toolName: tool.name,
        args,
        journalEnabled: options?.journalEnabled,
      });
      const diagnosticsEnabled =
        options?.approvalRateDiagnosticsEnabled === true && areDiagnosticsEnabledForProcess();
      if (classification.requiresApproval) {
        codingObservability.recordApprovalPrompt(diagnosticsEnabled);
      } else {
        codingObservability.recordApprovalSkip(diagnosticsEnabled);
      }
      if (diagnosticsEnabled) {
        codingObservability.reportApprovalRateDiagnostic((diagnostic) => {
          const message = "coding approval classification rate: " + diagnostic.status;
          if (diagnostic.status === "alert") diagnosticLogger.warn(message, { ...diagnostic });
          else diagnosticLogger.info(message, { ...diagnostic });
        });
      }
      const result = await tool.execute(toolCallId, args, signal, onUpdate);
      const prev =
        result.details && typeof result.details === "object" && !Array.isArray(result.details)
          ? (result.details as Record<string, unknown>)
          : {};
      return {
        ...result,
        details: {
          ...prev,
          destructive_tier: classification.tier,
          destructive_reason: classification.reason,
          requires_approval: classification.requiresApproval,
        },
      };
    },
  };
}
