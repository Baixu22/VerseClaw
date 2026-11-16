/**
 * Shadow "would trim" evidence for cache-boundary context pruning (TF-0646 / A6).
 *
 * Today the pruner is a real mutation: it either returns new messages or the
 * original ones, and an operator has no way to see what it would have done
 * without doing it. This module runs the same planner over a copy and reports
 * counts and sizes only, so the GO/NO-GO decision can be made from evidence
 * instead of from "turn it on and look".
 *
 * It never mutates the input, never writes a message body, and stays shadow: the
 * extension records it only when the dedicated flag is on, and never uses the
 * report to decide whether to prune.
 */
import { createHash } from "node:crypto";
import type { AgentMessage } from "../../runtime/index.js";
import { pruneContextMessages } from "./pruner.js";
import type { EffectiveContextPruningSettings } from "./settings.js";

export const WOULD_TRIM_REPORT_SCHEMA = "WouldTrimReport/v1" as const;

export type WouldTrimItem = {
  /** Stable owner reference: index + tool name + content digest, never the body. */
  ownerRef: string;
  index: number;
  toolName?: string;
  charsBefore: number;
  charsAfter: number;
  charsSaved: number;
  /** `soft-trim` rewrote a head/tail; `hard-clear` replaced the content. */
  action: "soft-trim" | "hard-clear";
};

export type WouldTrimReport = {
  schema: typeof WOULD_TRIM_REPORT_SCHEMA;
  /** True when the planner returned different messages. */
  wouldTrim: boolean;
  items: WouldTrimItem[];
  itemsBefore: number;
  itemsAfter: number;
  charsBefore: number;
  charsAfter: number;
  charsSaved: number;
  estimatedTokensSaved: number;
  /** A digest of the projected message array, for comparing two runs. */
  projectedDigest: string;
};

function messageChars(message: AgentMessage): number {
  try {
    return JSON.stringify(message).length;
  } catch {
    return 0;
  }
}

function digestMessages(messages: readonly AgentMessage[]): string {
  try {
    return `sha256:${createHash("sha256").update(JSON.stringify(messages), "utf8").digest("hex")}`;
  } catch {
    return "sha256:unavailable";
  }
}

function toolNameOf(message: AgentMessage): string | undefined {
  return message.role === "toolResult" && typeof message.toolName === "string"
    ? message.toolName
    : undefined;
}

function contentDigest(message: AgentMessage): string {
  try {
    return createHash("sha256")
      .update(JSON.stringify(message), "utf8")
      .digest("hex")
      .slice(0, 12);
  } catch {
    return "unavailable";
  }
}

/**
 * Build the shadow report.
 *
 * `pruneContextMessages` is deterministic and returns either the same array
 * reference or a new one; we use that to prove "no trim" without diffing bodies.
 */
export function buildWouldTrimReport(params: {
  messages: AgentMessage[];
  settings: EffectiveContextPruningSettings;
  ctx: Parameters<typeof pruneContextMessages>[0]["ctx"];
  isToolPrunable?: (toolName: string) => boolean;
  contextWindowTokensOverride?: number;
  dropThinkingBlocksForEstimate?: boolean;
  archiveRecallRetention?: Parameters<typeof pruneContextMessages>[0]["archiveRecallRetention"];
}): WouldTrimReport {
  const before = params.messages;
  const projected = pruneContextMessages({
    messages: before,
    settings: params.settings,
    ctx: params.ctx,
    archiveRecallRetention: params.archiveRecallRetention,
    ...(params.isToolPrunable ? { isToolPrunable: params.isToolPrunable } : {}),
    ...(params.contextWindowTokensOverride !== undefined
      ? { contextWindowTokensOverride: params.contextWindowTokensOverride }
      : {}),
    ...(params.dropThinkingBlocksForEstimate !== undefined
      ? { dropThinkingBlocksForEstimate: params.dropThinkingBlocksForEstimate }
      : {}),
  });

  const charsBefore = before.reduce((total, message) => total + messageChars(message), 0);
  const charsAfter = projected.reduce((total, message) => total + messageChars(message), 0);

  // Index alignment only holds when the pruner kept the array shape, which it
  // does for both soft-trim and hard-clear (it replaces items, never removes).
  const items: WouldTrimItem[] = [];
  if (projected !== before) {
    const limit = Math.min(before.length, projected.length);
    for (let index = 0; index < limit; index += 1) {
      const prior = before[index]!;
      const next = projected[index]!;
      if (prior === next) continue;
      const priorChars = messageChars(prior);
      const nextChars = messageChars(next);
      if (priorChars === nextChars) continue;
      const toolName = toolNameOf(prior);
      items.push({
        ownerRef: `msg:${index}:${toolName ?? prior.role}:${contentDigest(prior)}`,
        index,
        ...(toolName ? { toolName } : {}),
        charsBefore: priorChars,
        charsAfter: nextChars,
        charsSaved: Math.max(0, priorChars - nextChars),
        action: nextChars <= 64 ? "hard-clear" : "soft-trim",
      });
    }
  }

  const charsSaved = Math.max(0, charsBefore - charsAfter);
  return {
    schema: WOULD_TRIM_REPORT_SCHEMA,
    wouldTrim: projected !== before,
    items,
    itemsBefore: before.length,
    itemsAfter: projected.length,
    charsBefore,
    charsAfter,
    charsSaved,
    estimatedTokensSaved: Math.floor(charsSaved / 4),
    projectedDigest: digestMessages(projected),
  };
}

/**
 * The GO/NO-GO gate.
 *
 * NO-GO unless the evidence shows a material saving: fewer than one item or
 * fewer than 1% of chars saved is noise, not a reason to change the hot path.
 */
export function decideWouldTrimGate(report: WouldTrimReport): {
  decision: "go" | "no-go";
  reason: string;
} {
  if (!report.wouldTrim || report.items.length === 0) {
    return { decision: "no-go", reason: "no-trim" };
  }
  if (report.charsBefore === 0) {
    return { decision: "no-go", reason: "no-char-baseline" };
  }
  const ratio = report.charsSaved / report.charsBefore;
  if (ratio < 0.01) {
    return { decision: "no-go", reason: `saving-below-1pct (${(ratio * 100).toFixed(2)}%)` };
  }
  return {
    decision: "go",
    reason: `saved ${report.charsSaved} chars across ${report.items.length} item(s) (${(ratio * 100).toFixed(1)}%)`,
  };
}