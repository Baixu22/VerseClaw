import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AgentMessage } from "../agents/runtime/index.js";
import { computeNovelty } from "./context-health-monitor.js";
import {
  knowledgeTextUsage,
  retainedKnowledgeManifest,
  type KnowledgeCandidatePackingV2,
  type RetainedEvidenceManifestV1,
} from "./project-rag-packing.js";
import {
  admitPromptContribution,
  getBuiltinPromptContributionDeclaration,
  resolvePromptAuthorityMode,
  type PromptContributionAdmission,
  type PromptContributionAuthority,
} from "./prompt-contribution-authority.js";
import {
  chargeTurnInjection,
  precedenceIndexOf,
  type TurnInjectionChannel,
  type TurnInjectionDisposition,
  type TurnInjectionLedger,
} from "./turn-injection-budget.js";

export const CONTEXT_CANDIDATE_SCHEMA = "ContextCandidate/v1" as const;

export type ContextCandidateTarget = "system_prompt" | "message" | "message_replacement";

export const CONTEXT_CANDIDATE_AUTHORITIES = {
  system_prompt: "append_instruction",
  message: "append_data",
  message_replacement: "replace_messages",
} as const satisfies Record<ContextCandidateTarget, PromptContributionAuthority>;

export type ContextMessageReplacement = {
  original: AgentMessage[];
  replacement: AgentMessage[];
};

export type ContextCandidate = {
  schema: typeof CONTEXT_CANDIDATE_SCHEMA;
  candidateId: string;
  dedupKey: string;
  authority: {
    objectId: string;
    version: string;
    contentDigest: string;
  };
  sourceId: string;
  channel: TurnInjectionChannel;
  target: ContextCandidateTarget;
  text: string;
  ordinal?: number;
  knowledgePacking?: KnowledgeCandidatePackingV2;
  messageReplacement?: ContextMessageReplacement;
};

export type ContextCandidateLineageReason =
  | "collected"
  | "applied"
  | "duplicate"
  | "empty"
  | "budget-truncate"
  | "budget-drop"
  | "flag-off"
  | "kill-switch"
  | "stale-history"
  | "skip-channel";

export type ContextCandidateLineage = {
  promptAuthority?: "declared" | "default-data" | "warned";
  candidateId: string;
  dedupKey: string;
  sourceId: string;
  channel: TurnInjectionChannel;
  target: ContextCandidateTarget;
  disposition: TurnInjectionDisposition | "pending" | "duplicate";
  charsRequested: number;
  charsApplied: number;
  ordinal?: number;
  estimatedTokensRequested?: number;
  estimatedTokensApplied?: number;
  utf8BytesApplied?: number;
  reason: ContextCandidateLineageReason;
  /**
   * B-4: information-novelty of this candidate against the projection window
   * (0..1, 1 = fully new). Only set for unique candidates at finalize time.
   */
  novelty?: number;
};

export type ContextCandidateDiagnostics = {
  finalized: boolean;
  collected: number;
  unique: number;
  duplicates: number;
  charsRequested: number;
  charsApplied: number;
  /** B-4: mean novelty of the unique candidates (0..1); absent when empty. */
  avgNovelty?: number;
};

export type ContextCandidateCollection = {
  turnId: string;
  candidates: ContextCandidate[];
  lineage: ContextCandidateLineage[];
  candidateLineageIndexes: number[];
  diagnostics: ContextCandidateDiagnostics;
  projection?: ContextCandidateProjection;
};

export type ContextCandidateProjection = {
  retainedEvidence?: RetainedEvidenceManifestV1;
  messageReplacement?: ContextMessageReplacement;
  systemPromptAddition?: string;
  /** Ephemeral projected text for producer attribution; never persisted in lineage. */
  systemPromptContributions?: Array<{ sourceId: string; text: string }>;
  messages: AgentMessage[];
  lineage: ContextCandidateLineage[];
};

const collections = new Map<string, ContextCandidateCollection>();

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function identityPart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function createContextCandidate(input: {
  authorityObjectId: string;
  authorityVersion: string;
  sourceId: string;
  channel: TurnInjectionChannel;
  target: ContextCandidateTarget;
  text: string;
  knowledgePacking?: KnowledgeCandidatePackingV2;
  messageReplacement?: ContextMessageReplacement;
}): ContextCandidate {
  const contentDigest = digestText(input.text);
  const identity = [
    identityPart(input.authorityObjectId),
    identityPart(input.authorityVersion),
    contentDigest,
  ].join(":");
  const projectionIdentity = [
    identityPart(input.sourceId),
    input.channel,
    input.target,
    identity,
  ].join(":");
  return {
    schema: CONTEXT_CANDIDATE_SCHEMA,
    candidateId: `context-candidate:${projectionIdentity}`,
    dedupKey: `context-authority:${identity}:${input.target}`,
    authority: {
      objectId: input.authorityObjectId,
      version: input.authorityVersion,
      contentDigest,
    },
    sourceId: input.sourceId,
    channel: input.channel,
    target: input.target,
    text: input.text,
    ...(input.knowledgePacking ? { knowledgePacking: input.knowledgePacking } : {}),
    ...(input.messageReplacement ? { messageReplacement: input.messageReplacement } : {}),
  };
}

/** Exact multiset matching exempts retained history, never a rewritten summary
 * or a second copy of a historical message. No semantic inference is involved. */
export function contextMessageReplacementText(
  original: AgentMessage[],
  replacement: AgentMessage[],
): string {
  // ponytail: quadratic matching over the bounded attempt history; use a
  // canonical digest multiset if profiling shows long-history assembly cost.
  const remaining = original.slice();
  const added = replacement.filter((message) => {
    const index = remaining.findIndex((prior) => isDeepStrictEqual(prior, message));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  return added.length ? JSON.stringify(added) : "";
}

export function applyContextMessageReplacement(
  messages: AgentMessage[],
  plan?: ContextMessageReplacement,
): AgentMessage[] {
  // The runner materializes an admitted replacement once before precheck.
  // Cached context callbacks must never reapply it after replay normalization.
  if (
    !plan ||
    messages.length < plan.original.length ||
    !isDeepStrictEqual(messages.slice(0, plan.original.length), plan.original)
  )
    return messages;
  return [...plan.replacement, ...messages.slice(plan.original.length)];
}

export function recordContextCandidateSkip(
  turnId: string,
  input: {
    sourceId: string;
    channel: TurnInjectionChannel;
    target: ContextCandidateTarget;
    reason: Extract<
      ContextCandidateLineageReason,
      "empty" | "flag-off" | "kill-switch" | "skip-channel"
    >;
  },
): ContextCandidateLineage {
  const collection = beginContextCandidateCollection(turnId);
  if (collection.diagnostics.finalized) {
    return {
      candidateId: `context-source:${identityPart(input.sourceId)}:${input.channel}:${input.target}`,
      dedupKey: `context-source:${identityPart(input.sourceId)}:${input.target}`,
      sourceId: input.sourceId,
      channel: input.channel,
      target: input.target,
      disposition: "skip",
      charsRequested: 0,
      charsApplied: 0,
      reason: input.reason,
    };
  }
  const lineage: ContextCandidateLineage = {
    candidateId: `context-source:${identityPart(input.sourceId)}:${input.channel}:${input.target}`,
    dedupKey: `context-source:${identityPart(input.sourceId)}`,
    sourceId: input.sourceId,
    channel: input.channel,
    target: input.target,
    disposition: "skip",
    charsRequested: 0,
    charsApplied: 0,
    reason: input.reason,
  };
  collection.lineage.push(lineage);
  return lineage;
}

export function beginContextCandidateCollection(turnId: string): ContextCandidateCollection {
  const existing = collections.get(turnId);
  if (existing) return existing;
  const collection: ContextCandidateCollection = {
    turnId,
    candidates: [],
    lineage: [],
    candidateLineageIndexes: [],
    diagnostics: {
      finalized: false,
      collected: 0,
      unique: 0,
      duplicates: 0,
      charsRequested: 0,
      charsApplied: 0,
    },
  };
  collections.set(turnId, collection);
  return collection;
}

export function getContextCandidateCollection(
  turnId: string,
): ContextCandidateCollection | undefined {
  return collections.get(turnId);
}

/**
 * F-01: model-call boundary inside one attempt. The first finalize of a turn
 * freezes one immutable projection (one ContextBundle per model call). When the
 * tool loop reaches the *next* model call of the same attempt, the caller opens
 * a fresh collection for the same turnId so newly produced Blocks (e.g.
 * working_memory written by a tool_result) can be collected into the next
 * projection. The previous projection stays frozen — it is never mutated.
 */
export function reopenContextCandidateCollection(turnId: string): ContextCandidateCollection {
  const existing = collections.get(turnId);
  if (!existing?.diagnostics.finalized) {
    return beginContextCandidateCollection(turnId);
  }
  const collection: ContextCandidateCollection = {
    turnId,
    candidates: [],
    lineage: [],
    candidateLineageIndexes: [],
    diagnostics: {
      finalized: false,
      collected: 0,
      unique: 0,
      duplicates: 0,
      charsRequested: 0,
      charsApplied: 0,
    },
  };
  collections.set(turnId, collection);
  return collection;
}

export function collectContextCandidate(
  turnId: string,
  candidate: ContextCandidate,
  admission?: PromptContributionAdmission,
): ContextCandidateLineage {
  const collection = beginContextCandidateCollection(turnId);
  if (collection.diagnostics.finalized) {
    throw new Error(`context candidate collection already finalized: ${turnId}`);
  }
  // Admission precedes collection and budget charging; a rejected replacement
  // cannot enter a cached projection or masquerade as appended data.
  const requiredAuthority = CONTEXT_CANDIDATE_AUTHORITIES[candidate.target];
  const resolvedAdmission: PromptContributionAdmission = {
    ...admission,
    mode: admission?.mode ?? resolvePromptAuthorityMode(process.env.OPENCLAW_PROMPT_AUTHORITY_MODE),
    declaration:
      admission?.declaration ?? getBuiltinPromptContributionDeclaration(candidate.sourceId),
  };
  const promptAuthority = admitPromptContribution(
    candidate.sourceId,
    candidate.target,
    requiredAuthority,
    resolvedAdmission,
  );
  // Knowledge ordinal is assigned at DCS admission, never taken from renderer rank metadata.
  const ordinal = candidate.channel === "knowledge" ? collection.candidates.length : undefined;
  const usage = candidate.knowledgePacking ? knowledgeTextUsage(candidate.text) : undefined;
  const lineage: ContextCandidateLineage = {
    promptAuthority,
    candidateId: candidate.candidateId,
    dedupKey: candidate.dedupKey,
    sourceId: candidate.sourceId,
    channel: candidate.channel,
    target: candidate.target,
    disposition: "pending",
    charsRequested: candidate.text.length,
    charsApplied: 0,
    ...(ordinal !== undefined ? { ordinal } : {}),
    ...(usage ? { estimatedTokensRequested: usage.estimatedTokens } : {}),
    reason: "collected",
  };
  collection.candidates.push(ordinal === undefined ? candidate : { ...candidate, ordinal });
  collection.lineage.push(lineage);
  collection.candidateLineageIndexes.push(collection.lineage.length - 1);
  collection.diagnostics.collected += 1;
  return lineage;
}

function sortedCandidateIndexes(collection: ContextCandidateCollection): number[] {
  return collection.candidates
    .map((_, index) => index)
    .toSorted((leftIndex, rightIndex) => {
      const left = collection.candidates[leftIndex]!;
      const right = collection.candidates[rightIndex]!;
      const precedence = precedenceIndexOf(left.channel) - precedenceIndexOf(right.channel);
      if (precedence !== 0) return precedence;
      if (left.channel === "knowledge") return leftIndex - rightIndex;
      return left.candidateId < right.candidateId
        ? -1
        : left.candidateId > right.candidateId
          ? 1
          : 0;
    });
}

function reasonForDisposition(
  disposition: TurnInjectionDisposition,
  killed: boolean,
): ContextCandidateLineageReason {
  if (killed) return "kill-switch";
  if (disposition === "truncate") return "budget-truncate";
  if (disposition === "drop") return "budget-drop";
  if (disposition === "skip") return "empty";
  return "applied";
}

export function finalizeContextCandidates(params: {
  turnId: string;
  ledger: TurnInjectionLedger;
  messages?: AgentMessage[];
  /**
   * B-4: previously injected context text (e.g. recent turns) used as the
   * novelty comparison window. Candidates are scored against this window plus
   * the texts injected earlier in this same projection. Default: empty (only
   * same-turn overlap counts).
   */
  historyWindow?: readonly string[];
  /**
   * T-B6 (TF-0126): dedupKeys already injected by earlier model calls of this
   * same attempt. A reopened collection starts with an empty `seen` set, so
   * without this cross-call memory a re-collected working_memory candidate
   * with unchanged content (same contentDigest, same dedupKey) would inject
   * again. Candidates whose dedupKey is in this set are dispositioned
   * "duplicate" before any budget is charged. Default: none (legacy).
   */
  priorDedupKeys?: ReadonlySet<string>;
}): ContextCandidateProjection {
  const collection = beginContextCandidateCollection(params.turnId);
  if (collection.projection) return collection.projection;

  const seen = new Set<string>();
  const systemPromptParts: string[] = [];
  const systemPromptContributions: Array<{ sourceId: string; text: string }> = [];
  const messages: AgentMessage[] = [];
  let messageReplacement: ContextMessageReplacement | undefined;
  const injectedTexts: string[] = [...(params.historyWindow ?? [])];
  let noveltySum = 0;
  let noveltyCount = 0;

  for (const index of sortedCandidateIndexes(collection)) {
    const candidate = collection.candidates[index]!;
    const lineage = collection.lineage[collection.candidateLineageIndexes[index]!]!;
    if (
      candidate.target === "message_replacement" &&
      (!candidate.messageReplacement ||
        !params.messages ||
        !isDeepStrictEqual(
          params.messages.slice(0, candidate.messageReplacement.original.length),
          candidate.messageReplacement.original,
        ))
    ) {
      lineage.disposition = "skip";
      lineage.charsRequested = 0;
      lineage.reason = "stale-history";
      continue;
    }
    if (params.priorDedupKeys?.has(candidate.dedupKey)) {
      lineage.disposition = "duplicate";
      lineage.reason = "duplicate";
      collection.diagnostics.duplicates += 1;
      continue;
    }
    if (seen.has(candidate.dedupKey)) {
      lineage.disposition = "duplicate";
      lineage.reason = "duplicate";
      collection.diagnostics.duplicates += 1;
      continue;
    }
    seen.add(candidate.dedupKey);
    collection.diagnostics.unique += 1;

    // B-4: novelty against prior injected text (history + this turn).
    lineage.novelty = computeNovelty(candidate.text, injectedTexts);
    noveltySum += lineage.novelty;
    noveltyCount += 1;

    const charged = chargeTurnInjection(
      params.ledger,
      candidate.channel,
      candidate.text,
      candidate.target !== "message_replacement" && !candidate.knowledgePacking,
    );
    const entry = params.ledger.entries.at(-1);
    lineage.disposition = entry?.disposition ?? "skip";
    lineage.charsRequested = entry?.charsRequested ?? 0;
    lineage.charsApplied = charged.charsApplied;
    lineage.reason = reasonForDisposition(lineage.disposition, params.ledger.killed);
    if (candidate.knowledgePacking) {
      params.ledger.knowledgeProjections ??= [];
      const usage = knowledgeTextUsage(charged.text ?? "");
      lineage.estimatedTokensApplied = usage.estimatedTokens;
      lineage.utf8BytesApplied = usage.utf8Bytes;
    }
    collection.diagnostics.charsRequested += lineage.charsRequested;
    collection.diagnostics.charsApplied += lineage.charsApplied;

    if (!charged.text) continue;
    injectedTexts.push(charged.text);
    if (candidate.target === "message_replacement") {
      messageReplacement = candidate.messageReplacement;
    } else if (candidate.target === "system_prompt") {
      systemPromptParts.push(charged.text);
      systemPromptContributions.push({ sourceId: candidate.sourceId, text: charged.text });
    } else {
      const timestamp = Date.now();
      messages.push({ role: "user", content: charged.text, timestamp });
      if (candidate.knowledgePacking) {
        const usage = knowledgeTextUsage(charged.text);
        params.ledger.knowledgeProjections!.push({
          timestamp,
          unit: {
            ...structuredClone(candidate.knowledgePacking),
            candidateId: candidate.candidateId,
            ordinal: candidate.ordinal!,
            projectionDigest: digestText(charged.text),
            retainedChars: usage.chars,
            retainedUtf8Bytes: usage.utf8Bytes,
            estimatedTokens: usage.estimatedTokens,
          },
        });
      }
    }
  }

  if (noveltyCount > 0) {
    collection.diagnostics.avgNovelty = noveltySum / noveltyCount;
    // T-C1: hand the same average to the turn ledger so `endTurnInjectionBudget`
    // can score the `informationNovelty` health dimension from it. Reused rather
    // than recomputed (requirement-4) — and until now this average had no
    // consumer at all, which is why that dimension had no production input.
    params.ledger.avgNovelty = collection.diagnostics.avgNovelty;
  }

  const orderedLineage = collection.lineage.toSorted((left, right) => {
    const precedence = precedenceIndexOf(left.channel) - precedenceIndexOf(right.channel);
    if (precedence !== 0) return precedence;
    if (left.channel === "knowledge") return (left.ordinal ?? -1) - (right.ordinal ?? -1);
    return left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0;
  });
  collection.lineage = orderedLineage;
  collection.diagnostics.finalized = true;
  collection.projection = {
    ...(messageReplacement ? { messageReplacement } : {}),
    ...(systemPromptParts.length > 0
      ? { systemPromptAddition: systemPromptParts.join("\n\n"), systemPromptContributions }
      : {}),
    messages,
    lineage: orderedLineage,
  };
  return collection.projection;
}

export function projectContextCandidates(params: {
  turnId: string;
  ledger: TurnInjectionLedger;
  systemPrompt?: string;
  messages: AgentMessage[];
  /** T-B6 (TF-0126): forwarded to finalizeContextCandidates; see there. */
  priorDedupKeys?: ReadonlySet<string>;
}): { systemPrompt?: string; messages: AgentMessage[]; projection: ContextCandidateProjection } {
  const projection = finalizeContextCandidates(params);
  const systemPrompt = projection.systemPromptAddition
    ? params.systemPrompt
      ? `${params.systemPrompt}\n\n${projection.systemPromptAddition}`
      : projection.systemPromptAddition
    : params.systemPrompt;
  const additions = projection.messages.filter(
    (message) => !params.messages.some((previous) => isDeepStrictEqual(previous, message)),
  );
  const messages = additions.length ? [...params.messages, ...additions] : params.messages;
  const retainedEvidence = params.ledger.knowledgeProjections
    ? retainedKnowledgeManifest(params.turnId, params.ledger.knowledgeProjections, messages)
    : undefined;
  params.ledger.retainedEvidence = retainedEvidence;
  return {
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    messages,
    projection: retainedEvidence ? { ...projection, retainedEvidence } : projection,
  };
}

export function endContextCandidateCollection(
  turnId: string,
): ContextCandidateCollection | undefined {
  const collection = collections.get(turnId);
  collections.delete(turnId);
  return collection;
}

export function resetContextCandidateCollectionsForTests(): void {
  collections.clear();
}
