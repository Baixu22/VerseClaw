/**
 * Shadow-only value-based pruning helpers.
 *
 * Candidate generation and provider proposals are diagnostics. This module
 * does not remove or rewrite ContextItems on the live path.
 */
import { createHash } from "node:crypto";
import type { ArchiveHandle } from "../../../../shared/types/context-item.js";
import { createContextArchiveHandleForPayloadSync, createContextItemId } from "../registry/context-item-registry.js";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bauthorization\s*[:=]/iu,
];

export type ValuePruningItem = {
  id: string;
  kind: string;
  text: string;
  ageTurns?: number;
  referenceCount?: number;
  metadata?: Record<string, unknown>;
};

export type ValuePruningCandidateReason =
  | "duplicate_digest"
  | "superseded"
  | "resolved_error"
  | "stale_observation";

export type ValuePruningCandidate = {
  candidateId: string;
  item: ValuePruningItem;
  digest: string;
  reasons: ValuePruningCandidateReason[];
  estimatedChars: number;
  estimatedTokens: number;
  secretScanHits: number;
  eligible: boolean;
};

export type ValuePruningDecision = "keep" | "compress" | "drop";

export type ContextPruningProviderInput = {
  candidateId: string;
  text: string;
  kind: string;
  ageTurns?: number;
  reasons: ValuePruningCandidateReason[];
};

export type ContextPruningProviderDecision = {
  candidateId: string;
  decision: ValuePruningDecision;
  confidence: number;
  gist?: string;
};

export interface ContextPruningProvider {
  readonly id: string;
  propose(
    input: ContextPruningProviderInput,
  ): Promise<ContextPruningProviderDecision>;
}

export type ValuePruningReplacement = {
  candidateId: string;
  decision: "compress" | "drop";
  archiveHandle: ArchiveHandle;
  gist: string;
  projectedChars: number;
};

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function secretHits(text: string): number {
  return SECRET_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function metadataString(item: ValuePruningItem, key: string): string | undefined {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataBoolean(item: ValuePruningItem, key: string): boolean {
  return item.metadata?.[key] === true;
}

function addReason(set: Set<ValuePruningCandidateReason>, reason: ValuePruningCandidateReason): void {
  set.add(reason);
}

/**
 * Build deterministic, explainable would-prune candidates from existing items.
 * Input order is recency-ordered from oldest to newest.
 */
export function buildValuePruningCandidates(
  items: readonly ValuePruningItem[],
): ValuePruningCandidate[] {
  const groups = new Map<string, number[]>();
  for (const [index, item] of items.entries()) {
    const digest = digestText(item.text);
    const indexes = groups.get(digest) ?? [];
    indexes.push(index);
    groups.set(digest, indexes);
  }

  return items.flatMap((item, index) => {
    const reasons = new Set<ValuePruningCandidateReason>();
    const digest = digestText(item.text);
    const duplicateIndexes = groups.get(digest) ?? [];
    if (duplicateIndexes.length > 1 && index !== duplicateIndexes.at(-1)) {
      addReason(reasons, "duplicate_digest");
    }
    if (metadataString(item, "supersededBy")) {
      addReason(reasons, "superseded");
    }
    if (
      (item.kind === "error" || metadataString(item, "kind") === "error") &&
      (metadataBoolean(item, "resolved") || item.metadata?.status === "resolved")
    ) {
      addReason(reasons, "resolved_error");
    }
    const staleObservation =
      (item.ageTurns ?? 0) >= 5 &&
      (item.referenceCount ?? 0) <= 0 &&
      (item.kind === "trace" || item.kind === "other" || item.kind === "file");
    if (staleObservation) {
      addReason(reasons, "stale_observation");
    }
    if (reasons.size === 0) return [];
    const hits = secretHits(item.text);
    return [{
      candidateId: `value-prune:${item.id}`,
      item,
      digest,
      reasons: [...reasons].sort(),
      estimatedChars: item.text.length,
      estimatedTokens: Math.max(1, Math.ceil(item.text.length / 4)),
      secretScanHits: hits,
      eligible: hits === 0,
    }];
  });
}

export async function proposeValuePruningDecisions(
  provider: ContextPruningProvider,
  candidates: readonly ValuePruningCandidate[],
): Promise<ContextPruningProviderDecision[]> {
  const decisions: ContextPruningProviderDecision[] = [];
  for (const candidate of candidates) {
    if (!candidate.eligible) continue;
    const decision = await provider.propose({
      candidateId: candidate.candidateId,
      text: candidate.item.text,
      kind: candidate.item.kind,
      ...(candidate.item.ageTurns !== undefined ? { ageTurns: candidate.item.ageTurns } : {}),
      reasons: candidate.reasons,
    });
    if (decision.candidateId !== candidate.candidateId) {
      throw new Error(`Pruning provider returned mismatched candidate id: ${decision.candidateId}`);
    }
    if (
      !Number.isFinite(decision.confidence) ||
      decision.confidence < 0 ||
      decision.confidence > 1
    ) {
      throw new Error(`Pruning provider returned invalid confidence for ${candidate.candidateId}`);
    }
    decisions.push(decision);
  }
  return decisions;
}

function deterministicDecision(candidate: ValuePruningCandidate): ValuePruningDecision {
  if (
    candidate.reasons.includes("duplicate_digest") ||
    candidate.reasons.includes("superseded")
  ) {
    return "drop";
  }
  return "compress";
}

function gistFor(candidate: ValuePruningCandidate): string {
  const text = candidate.item.text.trim().replace(/\s+/gu, " ");
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

export function buildValuePruningShadowReport(params: {
  items: readonly ValuePruningItem[];
  decisions?: readonly ContextPruningProviderDecision[];
}): {
  inputItems: number;
  candidateCount: number;
  eligibleCandidates: number;
  secretBlockedCandidates: number;
  wouldDropCount: number;
  wouldCompressCount: number;
  wouldDropChars: number;
  projectedCharsAfterGist: number;
  providerCalls: number;
  candidates: ValuePruningCandidate[];
  decisions: ContextPruningProviderDecision[];
} {
  const candidates = buildValuePruningCandidates(params.items);
  const decisionMap = new Map(
    (params.decisions ?? []).map((decision) => [decision.candidateId, decision]),
  );
  let wouldDropCount = 0;
  let wouldCompressCount = 0;
  let wouldDropChars = 0;
  let projectedCharsAfterGist = 0;
  for (const candidate of candidates) {
    if (!candidate.eligible) continue;
    const decision = decisionMap.get(candidate.candidateId)?.decision ?? deterministicDecision(candidate);
    if (decision === "keep") continue;
    if (decision === "drop") wouldDropCount += 1;
    else wouldCompressCount += 1;
    wouldDropChars += candidate.estimatedChars;
    projectedCharsAfterGist += Math.min(candidate.estimatedChars, 240);
  }
  return {
    inputItems: params.items.length,
    candidateCount: candidates.length,
    eligibleCandidates: candidates.filter((candidate) => candidate.eligible).length,
    secretBlockedCandidates: candidates.filter((candidate) => !candidate.eligible).length,
    wouldDropCount,
    wouldCompressCount,
    wouldDropChars,
    projectedCharsAfterGist,
    providerCalls: params.decisions?.length ?? 0,
    candidates,
    decisions: [...(params.decisions ?? [])],
  };
}

/** Create archive handles for shadow decisions; no live ContextItem is mutated. */
export function materializeValuePruningShadow(params: {
  sessionId: string;
  candidates: readonly ValuePruningCandidate[];
  archiveRoot: string;
  decisions?: readonly ContextPruningProviderDecision[];
}): ValuePruningReplacement[] {
  const decisionMap = new Map(
    (params.decisions ?? []).map((decision) => [decision.candidateId, decision]),
  );
  return params.candidates.flatMap((candidate) => {
    if (!candidate.eligible) return [];
    const decision = decisionMap.get(candidate.candidateId)?.decision ?? deterministicDecision(candidate);
    if (decision === "keep") return [];
    const gist = decisionMap.get(candidate.candidateId)?.gist?.trim() || gistFor(candidate);
    const archiveHandle = createContextArchiveHandleForPayloadSync({
      sessionId: params.sessionId,
      itemId: createContextItemId(candidate.item.id),
      payload: { text: candidate.item.text, kind: candidate.item.kind },
      archiveRoot: params.archiveRoot,
      source: { type: "other", label: candidate.item.id },
    });
    return [{
      candidateId: candidate.candidateId,
      decision,
      archiveHandle,
      gist,
      projectedChars: gist.length,
    }];
  });
}
