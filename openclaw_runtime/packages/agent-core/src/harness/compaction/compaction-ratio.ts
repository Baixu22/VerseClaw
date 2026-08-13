// Agent Core module: Reasonix-aligned compaction ratio and trigger math.
//
// Faithful port of DeepSeek-Reasonix `internal/agent/compact.go` constants and
// trigger helpers. These are pure functions so they can be wired into the
// runtime's compaction path and unit-tested against the reference semantics.

import { fallbackTokPerChar, utf8ByteLength, utf8RuneCount } from "./token-calibration.js";

export const defaultCompactRatio = 0.85; // sole automatic maintenance trigger (new configs)
export const checkpointCeilingRatio = 0.5; // normal auto-checkpoint acceptance ceiling
export const recentTailBudgetRatio = 0.1; // recent verbatim tail as a fraction of the window
export const minRecentTailTokens = 32 * 1024;
export const maxRecentTailTokens = 96 * 1024;
export const summaryOutputMaxTokens = 16 * 1024; // max digest output
export const exceptionalMinSavingsRatio = 0.25; // when fixed prefix alone exceeds 50%
export const minRecentKeep = 2; // never keep fewer recent messages than this
export const minCompactMessages = 2; // skip compaction below this many compactable messages
export const maxPinnedFirstUserTokens = 1500; // ceiling on pinning the first user turn verbatim
export const pinnedFirstUserWindowFrac = 0.15;
export const maxKeptUserTurnTokens = 1500; // ceiling on carrying one folded user turn verbatim
export const keptUserTurnsBudgetTokens = 8192;
export const keptUserTurnsWindowFrac = 0.05;
export const protocolReserveTokens = 256; // provider framing/control fields not in message estimates

/** Re-exported so compaction callers need only one import. */
export { fallbackTokPerChar };

/**
 * Faithful port of `compactTrigger`: `max(1, contextWindow × ratio)`, with the
 * default ratio 0.85 (or 0.5 when compaction is ablated).
 */
export function compactTrigger(
  contextWindow: number,
  ratio = defaultCompactRatio,
  ablationOff = false,
): number {
  if (contextWindow <= 0) {
    return 0;
  }
  let effective = ratio;
  if (effective <= 0) {
    effective = defaultCompactRatio;
  }
  if (ablationOff) {
    effective = 0.5;
  }
  return Math.max(1, Math.floor(contextWindow * effective));
}

/** Faithful port of `hardInputCeiling`: `max(1, contextWindow - protocolReserve)`. */
export function hardInputCeiling(contextWindow: number): number {
  if (contextWindow <= 0) {
    return 0;
  }
  return Math.max(1, contextWindow - protocolReserveTokens);
}

/**
 * Faithful port of `recentTailBudget`: clamp(window×10%, 32K, 96K), dropping the
 * 32K floor for windows smaller than 64K so the tail cannot alone exceed it.
 */
export function recentTailBudget(contextWindow: number): number {
  if (contextWindow <= 0) {
    return minRecentTailTokens;
  }
  let n = Math.floor(contextWindow * recentTailBudgetRatio);
  if (contextWindow >= minRecentTailTokens * 2) {
    if (n < minRecentTailTokens) {
      n = minRecentTailTokens;
    }
  }
  if (n > maxRecentTailTokens) {
    n = maxRecentTailTokens;
  }
  const half = Math.floor(contextWindow / 2);
  if (half > 0 && n > half) {
    n = half;
  }
  return Math.max(1, n);
}

/** Faithful port of `checkpointCeiling`: `max(1, contextWindow × 0.50)`. */
export function checkpointCeiling(contextWindow: number): number {
  if (contextWindow <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor(contextWindow * checkpointCeilingRatio));
}

/** Faithful port of `exceptionalMinimumSavings`: `max(1, contextWindow × 0.25)`. */
export function exceptionalMinimumSavings(contextWindow: number): number {
  if (contextWindow <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor(contextWindow * exceptionalMinSavingsRatio));
}

/**
 * Faithful port of `estimateTextTokens`: `max(ceil(bytes/4), runes)`. CJK-heavy
 * text trends near one rune per token, so the rune count wins there.
 */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const bytes = utf8ByteLength(text);
  const runes = utf8RuneCount(text);
  const byBytes = Math.ceil(bytes / 4);
  return runes > byBytes ? runes : byBytes;
}

/** Minimal message shape consumed by `estimateMessagesTokens`. */
export type CompactableMessage = {
  localOnly?: boolean;
  content: string;
  reasoningContent?: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{ id?: string; name?: string; arguments?: string }>;
};

/**
 * Faithful port of `estimateMessagesTokens`: chat-message framing (4) + text
 * estimates per field, tool-call framing (8) per call.
 */
export function estimateMessagesTokens(messages: CompactableMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.localOnly) {
      continue;
    }
    total += 4;
    total += estimateTextTokens(m.content);
    total += estimateTextTokens(m.reasoningContent ?? "");
    total += estimateTextTokens(m.name ?? "");
    total += estimateTextTokens(m.toolCallId ?? "");
    for (const tc of m.toolCalls ?? []) {
      total += 8;
      total += estimateTextTokens(tc.id ?? "");
      total += estimateTextTokens(tc.name ?? "");
      total += estimateTextTokens(tc.arguments ?? "");
    }
  }
  return total;
}

/** Faithful port of `foldEconomics`: `estimateMessagesTokens(region) >= 400`. */
export function foldEconomics(region: CompactableMessage[]): boolean {
  const minFoldTokens = 400;
  return estimateMessagesTokens(region) >= minFoldTokens;
}
