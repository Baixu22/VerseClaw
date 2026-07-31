import type { MemoryCard, MemoryScoreInput } from "./types.js";

export type { MemoryCard, MemoryCardStatus, MemoryCardType, MemoryCardScope } from "./types.js";

export type MemoryCardScopeContext = {
  workspace?: string;
  sessionKey?: string;
  taskId?: string;
};

function clamp01(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

export function calculateMemoryScore(input: MemoryScoreInput): number {
  const score =
    clamp01(input.semanticRelevance) * 0.4 +
    clamp01(input.importance) * 0.25 +
    clamp01(input.recency) * 0.15 +
    clamp01(input.accessFrequency) * 0.1 +
    clamp01(input.roleRelevance) * 0.1 -
    clamp01(input.stalenessPenalty) -
    clamp01(input.contradictionPenalty);
  return Math.max(0, Number(score.toFixed(4)));
}

export function isMemoryCardExpired(card: MemoryCard, now = new Date()): boolean {
  return Boolean(card.expiresAt && new Date(card.expiresAt).getTime() <= now.getTime());
}

export function isInjectableMemoryCard(card: MemoryCard, now = new Date()): boolean {
  return card.status === "active" && !isMemoryCardExpired(card, now) && !card.supersededBy;
}

export function isMemoryCardInContextScope(
  card: MemoryCard,
  context: MemoryCardScopeContext,
): boolean {
  const scopeKey = card.scopeKey?.trim();
  if (card.scope === "workspace") {
    return Boolean(scopeKey && context.workspace?.trim() === scopeKey);
  }
  if (card.scope === "session") {
    return Boolean(scopeKey && context.sessionKey?.trim() === scopeKey);
  }
  if (card.scope === "task") {
    return Boolean(scopeKey && context.taskId?.trim() === scopeKey);
  }
  if (card.scope === "project" && scopeKey) {
    return context.workspace?.trim() === scopeKey;
  }
  return true;
}

export function touchMemoryCard(card: MemoryCard, at = new Date()): MemoryCard {
  return {
    ...card,
    lastAccessedAt: at.toISOString(),
    accessCount: card.accessCount + 1,
  };
}
