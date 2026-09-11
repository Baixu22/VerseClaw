import type { AgentMessage } from "../../types.js";
import type { CompactionSettings } from "./compaction.js";
import type { CompressionSemanticAtom } from "./compression-artifact.js";

export type CompressionTier = "tier0" | "tier1" | "tier2" | "tier3" | "tier4";

export type CompressionStrategy =
  | "hot-context"
  | "micro-compact"
  | "token-pruning"
  | "semantic-handoff"
  | "emergency-collapse";

export type CompressionPlan = {
  tier: CompressionTier;
  strategy: CompressionStrategy;
  pressure: number;
};

/** Optional per-task-class thresholds. P5 only allows earlier (lower) values. */
export type TierThresholds = {
  tier1?: number;
  tier2?: number;
  tier3?: number;
  tier4?: number;
};

export type TierSchedule = {
  taskClass?: string;
  thresholds: TierThresholds;
  budgetTokens?: number;
  reason?: string;
};

/** The production reactive ladder; unchanged absent overrides. */
export const DEFAULT_TIER_THRESHOLDS = {
  tier1: 0.6,
  tier2: 0.75,
  tier3: 0.85,
  tier4: 0.95,
} as const;

export type ResolvedTierThresholds = {
  tier1: number;
  tier2: number;
  tier3: number;
  tier4: number;
};

export type CompressionTelemetry = {
  tier: CompressionTier;
  strategy: CompressionStrategy;
  pressure: number;
  tokensBefore: number;
  tokensAfter?: number;
  compressionRatio?: number;
  warnings: string[];
  staleExcludedCount: number;
  causalAnchorCount: number;
  rehydratedFiles: string[];
  /** Optional P5 shadow metadata; absent unless a tierSchedule was supplied. */
  taskClass?: string;
  budgetTokens?: number;
};

export type TokenPruningAdapter = (input: {
  text: string;
  targetRatio: number;
  causalAnchors: readonly string[];
}) => { text: string; causalAnchorCount: number; warnings?: string[] };

export type CompressionPlannerInput = {
  tokensBefore: number;
  settings: CompactionSettings;
  messages: AgentMessage[];
  staleExcludedCount?: number;
  readFiles?: string[];
  modifiedFiles?: string[];
  tokenPruningAdapter?: TokenPruningAdapter;
  /** P5 optional task-class schedule. It only changes plan.tier. */
  tierSchedule?: TierSchedule;
};

export type CompressionPlannerResult = {
  plan: CompressionPlan;
  messages: AgentMessage[];
  telemetry: CompressionTelemetry;
};

const CAUSAL_ANCHORS = [
  "because",
  "since",
  "due to",
  "caused by",
  "so that",
  "failed",
  "error",
  "broke",
  "regression",
  "bug",
  "decided",
  "switched",
  "chose",
  "instead",
  "constraint",
  "blocked",
  "however",
  "although",
  "rather",
  "因为",
  "由于",
  "导致",
  "所以",
  "失败",
  "错误",
  "回归",
  "决定",
  "切换",
  "选择",
  "约束",
  "但是",
  "然而",
  "不过",
  "反而",
] as const;

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function thresholdValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Resolve P5 thresholds. Every user threshold is clamped into
 * [0, DEFAULT_TIER_THRESHOLDS.x], so the production ladder can only be made
 * earlier, never later. Non-monotonic schedules fall back to production
 * defaults (the safe hard backstop).
 */
export function resolveTierThresholds(input?: TierThresholds): ResolvedTierThresholds {
  const tier1 = Math.max(
    0,
    Math.min(
      thresholdValue(input?.tier1, DEFAULT_TIER_THRESHOLDS.tier1),
      DEFAULT_TIER_THRESHOLDS.tier1,
    ),
  );
  const tier2 = Math.max(
    0,
    Math.min(
      thresholdValue(input?.tier2, DEFAULT_TIER_THRESHOLDS.tier2),
      DEFAULT_TIER_THRESHOLDS.tier2,
    ),
  );
  const tier3 = Math.max(
    0,
    Math.min(
      thresholdValue(input?.tier3, DEFAULT_TIER_THRESHOLDS.tier3),
      DEFAULT_TIER_THRESHOLDS.tier3,
    ),
  );
  const tier4 = Math.max(
    0,
    Math.min(
      thresholdValue(input?.tier4, DEFAULT_TIER_THRESHOLDS.tier4),
      DEFAULT_TIER_THRESHOLDS.tier4,
    ),
  );
  if (!(tier1 < tier2 && tier2 < tier3 && tier3 < tier4)) {
    return { ...DEFAULT_TIER_THRESHOLDS };
  }
  return { tier1, tier2, tier3, tier4 };
}

export function selectCompressionPlan(input: {
  tokensBefore: number;
  settings: CompactionSettings;
  contextWindow?: number;
  thresholds?: TierThresholds;
}): CompressionPlan {
  const budget = Math.max(
    1,
    input.contextWindow ??
      input.settings.contextWindow ??
      input.settings.reserveTokens + input.settings.keepRecentTokens,
  );
  const pressure = Math.max(0, input.tokensBefore / budget);
  const thresholds = resolveTierThresholds(input.thresholds);
  if (pressure < thresholds.tier1) return { tier: "tier0", strategy: "hot-context", pressure: round(pressure) };
  if (pressure < thresholds.tier2) return { tier: "tier1", strategy: "micro-compact", pressure: round(pressure) };
  if (pressure < thresholds.tier3) return { tier: "tier2", strategy: "token-pruning", pressure: round(pressure) };
  if (pressure < thresholds.tier4) return { tier: "tier3", strategy: "semantic-handoff", pressure: round(pressure) };
  return { tier: "tier4", strategy: "emergency-collapse", pressure: round(pressure) };
}

export type CriticalFirstBudgetField =
  | "criticalLedger"
  | "latestUserAsk"
  | "unfinishedActions"
  | "failureChainValidation"
  | "exactIdentifiers"
  | "importantFacts"
  | "niceToHaveProse";

export type CriticalFirstBudgetInput = {
  criticalLedger?: CompressionSemanticAtom[];
  latestUserAsk?: string;
  unfinishedActions?: string[];
  failureChainValidation?: string[];
  exactIdentifiers?: string[];
  importantFacts?: string[];
  niceToHaveProse?: string[];
  budgetTokens: number;
};

export type CriticalFirstBudgetPlan = {
  allowedTokens: Partial<Record<CriticalFirstBudgetField, number>>;
  order: CriticalFirstBudgetField[];
  truncated: CriticalFirstBudgetField[];
};

export const CRITICAL_FIRST_BUDGET_ORDER: CriticalFirstBudgetField[] = [
  "criticalLedger",
  "latestUserAsk",
  "unfinishedActions",
  "failureChainValidation",
  "exactIdentifiers",
  "importantFacts",
  "niceToHaveProse",
];

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateStringListTokens(items: string[] | undefined): number {
  if (!items) return 0;
  return items.reduce((total, item) => total + estimateTextTokens(item), 0);
}

function estimateCriticalLedgerTokens(atoms: CompressionSemanticAtom[] | undefined): number {
  if (!atoms) return 0;
  return atoms.reduce((total, item) => total + estimateTextTokens(item.text), 0);
}

/**
 * P5 deterministic shadow budget. The order is fixed and the function only
 * estimates tokens (chars/4, matching estimateTokens) and marks bounded
 * truncation. It never calls a model and never changes summary/artifact paths.
 */
export function planCriticalFirstBudget(input: CriticalFirstBudgetInput): CriticalFirstBudgetPlan {
  const remainingBudget =
    typeof input.budgetTokens === "number" && Number.isFinite(input.budgetTokens)
      ? Math.max(0, input.budgetTokens)
      : 0;
  const estimates: Record<CriticalFirstBudgetField, number> = {
    criticalLedger: estimateCriticalLedgerTokens(input.criticalLedger),
    latestUserAsk: estimateTextTokens(input.latestUserAsk ?? ""),
    unfinishedActions: estimateStringListTokens(input.unfinishedActions),
    failureChainValidation: estimateStringListTokens(input.failureChainValidation),
    exactIdentifiers: estimateStringListTokens(input.exactIdentifiers),
    importantFacts: estimateStringListTokens(input.importantFacts),
    niceToHaveProse: estimateStringListTokens(input.niceToHaveProse),
  };
  const order = [...CRITICAL_FIRST_BUDGET_ORDER];
  const allowedTokens: CriticalFirstBudgetPlan["allowedTokens"] = {};
  const truncated: CriticalFirstBudgetField[] = [];
  let remaining = remainingBudget;
  for (const field of order) {
    const estimated = estimates[field];
    const supplied =
      field === "criticalLedger"
        ? input.criticalLedger !== undefined
        : field === "latestUserAsk"
          ? input.latestUserAsk !== undefined
          : input[field] !== undefined;
    const allowed = Math.min(remaining, estimated);
    if (supplied) allowedTokens[field] = allowed;
    remaining -= allowed;
    if (supplied && allowed < estimated) truncated.push(field);
  }
  return { allowedTokens, order, truncated };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") return [record.text];
      if (typeof record.content === "string") return [record.content];
      return [];
    })
    .join("\n");
}

function textFromMessage(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>;
  if (record.role === "bashExecution") {
    const command = typeof record.command === "string" ? record.command : "";
    const output = typeof record.output === "string" ? record.output : "";
    const exitCode = typeof record.exitCode === "number" ? `exit code: ${record.exitCode}` : "";
    return [command ? `$ ${command}` : "", exitCode, output].filter(Boolean).join("\n");
  }
  return textFromContent(record.content);
}

function replaceMessageText(message: AgentMessage, text: string): AgentMessage {
  const record = message as unknown as Record<string, unknown>;
  if (record.role === "bashExecution" && typeof record.output === "string") {
    return { ...(message as object), output: text } as AgentMessage;
  }
  if (typeof record.content === "string") {
    return { ...(message as object), content: text } as AgentMessage;
  }
  if (Array.isArray(record.content)) {
    let replaced = false;
    const content = record.content.map((block) => {
      if (!block || typeof block !== "object") return block;
      const blockRecord = block as Record<string, unknown>;
      if (!replaced && typeof blockRecord.text === "string") {
        replaced = true;
        return { ...blockRecord, text };
      }
      return block;
    });
    return { ...(message as object), content } as AgentMessage;
  }
  return message;
}

function compactLines(text: string, head = 24, tail = 24, label = "micro-compacted"): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= head + tail + 4) return text;
  return [
    ...lines.slice(0, head),
    `[... ${lines.length - head - tail} lines ${label} ...]`,
    ...lines.slice(-tail),
  ].join("\n");
}

function compactStackFrames(text: string): string {
  const lines = text.split(/\r?\n/);
  let omitted = 0;
  const kept: string[] = [];
  let stackRun = 0;
  for (const line of lines) {
    const isFrame = /^\s*at\s+|\s+File ".*", line \d+/u.test(line);
    if (isFrame) {
      stackRun += 1;
      if (stackRun > 4 && stackRun < lines.length - 2) {
        omitted += 1;
        continue;
      }
    } else {
      stackRun = 0;
    }
    kept.push(line);
  }
  return omitted > 0 ? `${kept.join("\n")}\n[... ${omitted} repeated stack frames omitted ...]` : text;
}

function compactToolOutput(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= 56) return text;
  const commandLine = lines.find((line) => /^\s*(?:[$>]|command:)/iu.test(line));
  const exitLine = lines.find((line) => /\b(?:exit code|exitCode|status)\b\s*[:=]\s*-?\d+/iu.test(line));
  const errorLines = lines
    .filter((line) => /\b(error|failed|exception|denied|enoent|traceback|fatal)\b/iu.test(line))
    .slice(0, 8);
  return [
    commandLine ? `command: ${commandLine.replace(/^\s*(?:[$>]\s*)?/u, "").trim()}` : "",
    exitLine ? `exit: ${exitLine.trim()}` : "",
    errorLines.length ? `error summary:\n${errorLines.map((line) => `- ${line.trim()}`).join("\n")}` : "",
    "head:",
    ...lines.slice(0, 18),
    `[... ${Math.max(0, lines.length - 36)} tool output lines micro-compacted ...]`,
    "tail:",
    ...lines.slice(-18),
  ].filter(Boolean).join("\n");
}

function compactFileBody(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= 64) return text;
  const selected = new Map<number, string>();
  const keepWindow = (index: number, radius: number) => {
    for (let i = Math.max(0, index - radius); i <= Math.min(lines.length - 1, index + radius); i++) {
      selected.set(i, lines[i]);
    }
  };
  lines.forEach((line, index) => {
    if (/^@@\s/u.test(line)) keepWindow(index, 4);
    if (/\b(?:[A-Za-z]:)?[./\\\w -]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|java|css|scss|html)\b/u.test(line)) {
      keepWindow(index, 1);
    }
    if (/^\s*(?:(?:export\s+)?(?:async\s+)?(?:function|class|interface|type)\s+\w+|export\s+const\s+\w+)/u.test(line)) {
      keepWindow(index, 1);
    }
    if (/\b(?:TODO|FIXME|failed|error|regression|because|decision|constraint)\b/iu.test(line)) {
      keepWindow(index, 2);
    }
  });
  for (let i = 0; i < Math.min(10, lines.length); i++) selected.set(i, lines[i]);
  for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) selected.set(i, lines[i]);
  const ordered = [...selected.entries()].sort((a, b) => a[0] - b[0]);
  const output: string[] = [];
  let previous = -1;
  for (const [index, line] of ordered) {
    if (previous >= 0 && index > previous + 1) {
      output.push(`[... ${index - previous - 1} file body lines omitted ...]`);
    }
    output.push(line);
    previous = index;
  }
  return output.join("\n");
}

function looksLikeStackTrace(text: string): boolean {
  return /(?:\bTraceback \(most recent call last\):|\n\s*at\s+\S+|Exception\b|Error:)/u.test(text);
}

function looksLikeToolOutput(text: string): boolean {
  return /^\s*(?:[$>]|command:)/imu.test(text) || /\b(?:exit code|exitCode|status)\b\s*[:=]\s*-?\d+/iu.test(text);
}

function looksLikeFileBody(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 64) return false;
  const codeLike = lines.filter((line) => (
    /^\s*(?:import|export|function|class|interface|type)\b/u.test(line)
    || /^\s*[{}()[\],;]+$/u.test(line)
    || /^@@\s/u.test(line)
  )).length;
  return codeLike >= 8 || /\b(?:Get-Content|cat|sed -n|src\/|src\\|tests\/|tests\\)\b/iu.test(text);
}

export function microCompactText(text: string): string {
  if (looksLikeStackTrace(text)) {
    return compactLines(compactStackFrames(text), 18, 18, "stack trace micro-compacted");
  }
  if (looksLikeToolOutput(text)) {
    return compactToolOutput(text);
  }
  if (looksLikeFileBody(text)) {
    return compactFileBody(text);
  }
  return compactLines(text);
}

function anchorPositions(words: string[], anchors: readonly string[]): number[] {
  const lowerAnchors = anchors.map((item) => item.toLowerCase());
  const positions: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const lower = words[i].toLowerCase();
    if (lowerAnchors.some((anchor) => lower.includes(anchor))) {
      positions.push(i);
    }
  }
  return positions;
}

export function defaultTokenPruningAdapter(input: {
  text: string;
  targetRatio: number;
  causalAnchors: readonly string[];
}): { text: string; causalAnchorCount: number; warnings?: string[] } {
  const words = input.text.match(/\S+/gu) ?? [];
  if (words.length <= 80) return { text: input.text, causalAnchorCount: 0 };
  const target = Math.max(40, Math.floor(words.length * input.targetRatio));
  const keep = new Set<number>();
  const head = Math.min(48, Math.floor(target * 0.3));
  const tail = Math.min(48, Math.floor(target * 0.25));
  for (let i = 0; i < head; i++) keep.add(i);
  for (let i = Math.max(0, words.length - tail); i < words.length; i++) keep.add(i);

  const anchors = anchorPositions(words, input.causalAnchors);
  for (const pos of anchors) {
    for (let i = Math.max(0, pos - 5); i <= Math.min(words.length - 1, pos + 5); i++) {
      keep.add(i);
    }
  }

  for (let i = head; i < words.length - tail && keep.size < target; i += 3) {
    keep.add(i);
  }

  const sorted = [...keep].sort((a, b) => a - b);
  const output: string[] = [];
  let previous = -1;
  for (const index of sorted) {
    if (previous >= 0 && index > previous + 1) {
      output.push(`[... ${index - previous - 1} tokens pruned ...]`);
    }
    output.push(words[index]);
    previous = index;
  }
  return {
    text: output.join(" "),
    causalAnchorCount: anchors.length,
    warnings: anchors.length === 0 ? ["no_causal_anchors_found"] : undefined,
  };
}

function pruneMessageText(
  text: string,
  adapter: TokenPruningAdapter,
): { text: string; causalAnchorCount: number; warnings: string[] } {
  const result = adapter({ text, targetRatio: 0.45, causalAnchors: CAUSAL_ANCHORS });
  return {
    text: result.text,
    causalAnchorCount: result.causalAnchorCount,
    warnings: result.warnings ?? [],
  };
}

function uniqueFiles(readFiles: string[], modifiedFiles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of [...modifiedFiles, ...readFiles]) {
    const normalized = file.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 5) break;
  }
  return out;
}

function emergencyCollapseMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 4) return messages;
  const retained = new Map<number, AgentMessage>();
  const firstObjectiveIndex = messages.findIndex((message) => {
    const role = (message as { role?: unknown }).role;
    return role === "user" && textFromMessage(message).trim().length > 0;
  });
  if (firstObjectiveIndex >= 0) retained.set(firstObjectiveIndex, messages[firstObjectiveIndex]);

  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textFromMessage(messages[i]);
    if (/\b(?:next action|next step|todo|continue|constraint|blocked)\b|下一步|继续|约束|阻塞/iu.test(text)) {
      retained.set(i, messages[i]);
      break;
    }
  }

  for (let i = Math.max(0, messages.length - 4); i < messages.length; i++) {
    retained.set(i, messages[i]);
  }
  return [...retained.entries()].sort((a, b) => a[0] - b[0]).map(([, message]) => message);
}

export function planCompression(input: CompressionPlannerInput): CompressionPlannerResult {
  const plan = selectCompressionPlan({
    tokensBefore: input.tokensBefore,
    settings: input.settings,
    ...(input.tierSchedule ? { thresholds: input.tierSchedule.thresholds } : {}),
  });
  const warnings: string[] = [];
  let causalAnchorCount = 0;
  let messages = input.messages;

  if (plan.tier === "tier1" || plan.tier === "tier2" || plan.tier === "tier3" || plan.tier === "tier4") {
    messages = messages.map((message) => {
      const text = textFromMessage(message);
      if (!text || text.length < 1200) return message;
      return replaceMessageText(message, microCompactText(text));
    });
  }

  if (plan.tier === "tier2" || plan.tier === "tier3" || plan.tier === "tier4") {
    const adapter = input.tokenPruningAdapter ?? defaultTokenPruningAdapter;
    messages = messages.map((message, index) => {
      const isHot = index >= messages.length - 4;
      if (isHot) return message;
      const text = textFromMessage(message);
      if (!text || text.length < 600) return message;
      const pruned = pruneMessageText(text, adapter);
      causalAnchorCount += pruned.causalAnchorCount;
      warnings.push(...pruned.warnings);
      return replaceMessageText(message, pruned.text);
    });
  }

  if (plan.tier === "tier4" && messages.length > 4) {
    warnings.push("emergency_collapse_retained_objective_next_action_and_recent_tail");
    messages = emergencyCollapseMessages(messages);
  }

  const telemetry: CompressionTelemetry = {
    tier: plan.tier,
    strategy: plan.strategy,
    pressure: plan.pressure,
    tokensBefore: input.tokensBefore,
    warnings: [...new Set(warnings)],
    staleExcludedCount: input.staleExcludedCount ?? 0,
    causalAnchorCount,
    rehydratedFiles: uniqueFiles(input.readFiles ?? [], input.modifiedFiles ?? []),
    ...(input.tierSchedule?.taskClass ? { taskClass: input.tierSchedule.taskClass } : {}),
    ...(typeof input.tierSchedule?.budgetTokens === "number" &&
    Number.isFinite(input.tierSchedule.budgetTokens)
      ? { budgetTokens: input.tierSchedule.budgetTokens }
      : {}),
  };
  return { plan, messages, telemetry };
}

export function finalizeCompressionTelemetry(
  telemetry: CompressionTelemetry,
  tokensAfter: number | undefined,
): CompressionTelemetry {
  if (typeof tokensAfter !== "number" || !Number.isFinite(tokensAfter)) return telemetry;
  return {
    ...telemetry,
    tokensAfter,
    compressionRatio: telemetry.tokensBefore > 0 ? round(tokensAfter / telemetry.tokensBefore) : undefined,
  };
}

/**
 * JSON-serializable P5 diagnostics. This lives on CompactionDetails only and
 * must never be written into CompressionArtifact.
 */
export type CompactionBudgetShadow = {
  taskClass?: string;
  plannedTier: CompressionTier;
  actualTier: CompressionTier;
  ignored: boolean;
  budgetExceeded: boolean;
  budgetTokens?: number;
  tokensBefore: number;
  generatedAt: string;
};

export function buildCompactionBudgetShadow(input: {
  schedule: TierSchedule | undefined;
  settings: CompactionSettings;
  tokensBefore: number;
  actualTier?: CompressionTier;
  ignored?: boolean;
  generatedAt?: string;
}): CompactionBudgetShadow | undefined {
  if (!input.schedule) return undefined;
  const plannedTier = selectCompressionPlan({
    tokensBefore: input.tokensBefore,
    settings: input.settings,
    thresholds: input.schedule.thresholds,
  }).tier;
  const actualTier = input.actualTier ?? plannedTier;
  const budgetTokens =
    typeof input.schedule.budgetTokens === "number" && Number.isFinite(input.schedule.budgetTokens)
      ? input.schedule.budgetTokens
      : undefined;
  return {
    ...(input.schedule.taskClass ? { taskClass: input.schedule.taskClass } : {}),
    plannedTier,
    actualTier,
    ignored: input.ignored ?? actualTier !== plannedTier,
    budgetExceeded: budgetTokens !== undefined && input.tokensBefore > budgetTokens,
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
    tokensBefore: input.tokensBefore,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
