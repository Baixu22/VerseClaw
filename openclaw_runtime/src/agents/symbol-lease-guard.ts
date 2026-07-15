/**
 * C5-1: optional symbol/path write lease wrap for edit/write/apply_patch.
 * Default OFF — enabled only when runtime.coding.symbolLease.enabled=true (or override).
 * Fail-closed on conflict; release on success or error.
 */
import {
  acquireSymbolLease,
  releaseSymbolLease,
  type SymbolLease,
} from "../context-engine/factstore/symbol-lease.js";
import type { SymbolLeaseMode } from "../context-engine/coding-runtime-flags.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { extractPatchTargetPaths } from "./tools/write-journal.js";

export type SymbolLeaseGuardOptions = {
  workspaceRoot: string;
  holderId: string;
  enabled?: boolean;
  mode?: SymbolLeaseMode;
  ttlMs?: number;
  /** Override now for tests. */
  nowMs?: number;
};

export class SymbolLeaseHeldError extends Error {
  readonly code = "SYMBOL_LEASE_HELD";
  readonly holderId?: string;
  readonly expiresAtMs?: number;
  constructor(symbolKey: string, holderId?: string, expiresAtMs?: number) {
    super(
      `Symbol lease held for ${symbolKey}` +
        (holderId ? ` by ${holderId}` : "") +
        (expiresAtMs ? ` until ${expiresAtMs}` : "") +
        ". Wait for release/expiry or write a disjoint path/symbol.",
    );
    this.name = "SymbolLeaseHeldError";
    this.holderId = holderId;
    this.expiresAtMs = expiresAtMs;
  }
}

/** File-level placeholder when no explicit symbol is supplied (path → symbol promote). */
export const FILE_LEVEL_SYMBOL = "__file__";

export function resolveWriteTargetsFromArgs(toolName: string, args: unknown): Array<{
  filePath?: string;
  symbolName: string;
}> {
  const record = getToolParamsRecord(args) ?? {};
  const explicitSymbol =
    typeof record.symbolName === "string" && record.symbolName.trim()
      ? record.symbolName.trim()
      : typeof record.symbol === "string" && record.symbol.trim()
        ? record.symbol.trim()
        : undefined;

  if (toolName === "apply_patch") {
    const input = typeof record.input === "string" ? record.input : "";
    const paths = extractPatchTargetPaths(input);
    if (paths.length === 0) {
      return explicitSymbol ? [{ symbolName: explicitSymbol }] : [];
    }
    return paths.map((filePath) => ({
      filePath,
      symbolName: explicitSymbol ?? FILE_LEVEL_SYMBOL,
    }));
  }

  const filePath = typeof record.path === "string" && record.path.trim() ? record.path.trim() : undefined;
  if (!filePath && !explicitSymbol) {
    return [];
  }
  return [
    {
      filePath,
      symbolName: explicitSymbol ?? FILE_LEVEL_SYMBOL,
    },
  ];
}

export function wrapToolWithSymbolLease(
  tool: AnyAgentTool,
  options: SymbolLeaseGuardOptions,
): AnyAgentTool {
  if (options.enabled !== true) {
    return tool;
  }
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const targets = resolveWriteTargetsFromArgs(tool.name, args);
      const held: Array<{ symbolName: string; filePath?: string; lease: SymbolLease }> = [];
      try {
        for (const target of targets) {
          const result = acquireSymbolLease({
            workspaceRoot: options.workspaceRoot,
            holderId: options.holderId,
            symbolName: target.symbolName,
            filePath: target.filePath,
            ttlMs: options.ttlMs,
            nowMs: options.nowMs,
            mode: options.mode ?? "memory",
          });
          if (!result.ok) {
            throw new SymbolLeaseHeldError(
              `${(target.filePath ?? "").replace(/\\/g, "/")}::${target.symbolName}`,
              result.holderId,
              result.expiresAtMs,
            );
          }
          held.push({ ...target, lease: result.lease });
        }
        return await tool.execute(toolCallId, args, signal, onUpdate);
      } finally {
        for (const item of held) {
          releaseSymbolLease({
            workspaceRoot: options.workspaceRoot,
            holderId: options.holderId,
            symbolName: item.symbolName,
            filePath: item.filePath,
            mode: options.mode ?? "memory",
          });
        }
      }
    },
  };
}