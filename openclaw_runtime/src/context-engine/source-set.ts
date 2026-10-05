import { createHash } from "node:crypto";
import type { RuntimeEmbeddingProvider } from "../runtime-core/memory-embedding-provider.js";
import type { ResolvedChatKnowledgeRef } from "./chat-knowledge-intent.js";

/**
 * KS-07 SourceSet/v1 derived report.
 *
 * SourceSet is a DCS-derived answer/report, not a canonical store and not a
 * second context authority. DCS remains the only admission/resolve/pack/compile
 * authority; this module only ranks and discloses materialized source evidence.
 */

export const SOURCE_SET_SCHEMA = "SourceSet/v1" as const;

export type SourceSetOwner =
  | "memory-wiki"
  | "memory-slot"
  | "sekb"
  | "task-ledger"
  | "session"
  | "archive";

export type SourceSetSubjectKind =
  | "wiki-page"
  | "memory-card"
  | "experience-principle"
  | "task-context"
  | "transcript"
  | "artifact";

export type SourceSetTrust = "untrusted" | "advisory" | "confirmed" | "high-trust";
export type SourceSetSensitivity =
  | "public"
  | "workspace"
  | "sensitive"
  | "secret-adjacent"
  | "secret";

export type SourceSetStatus =
  | "active"
  | "archived"
  | "revoked"
  | "deleted"
  | "denied"
  | "stale";

export type SourceSetRef = {
  refId: string;
  owner: SourceSetOwner;
  subjectKind: SourceSetSubjectKind;
  subjectId: string;
  revision: string;
  contentDigest: string;
  scope?: {
    workspaceId?: string;
    agentId?: string;
    roleTags?: string[];
    sessionKey?: string;
    taskId?: string;
  };
  trust: SourceSetTrust;
  sensitivity: SourceSetSensitivity;
  retention?: {
    policy: "source-coupled" | "promoted" | "ephemeral" | "legal-hold";
    expiresAt?: string;
  };
  acl: { read: string[] };
  provenance?: {
    sourceRefs: string[];
    evidenceRefs: string[];
    derivedFrom?: string[];
  };
};

export type SourceSetClaimSeed = {
  claimId: string;
  statement: string;
  stance: string;
};

export type SourceSetCandidate = {
  ref: SourceSetRef;
  content: string;
  status: SourceSetStatus;
  statusReason?: string;
  indexedAt: string;
  claims?: SourceSetClaimSeed[];
  conflictKeys?: string[];
};

export type SourceSetPinnedRef = {
  owner: SourceSetOwner;
  subjectId: string;
  revision?: string;
  contentDigest?: string;
};

export type SourceSetQueryContext = {
  taskId?: string;
  taskIntent?: string;
  taskType?: string;
  workspaceId?: string;
  agentId?: string;
  roleTags?: string[];
};

export type SourceSetQuery = {
  text: string;
  taskContext?: SourceSetQueryContext;
  aclSubjects?: string[];
  sensitivityCeiling?: SourceSetSensitivity;
  pinnedRefs?: SourceSetPinnedRef[];
  limit?: number;
};

export type SourceSetLane = "exact" | "lexical" | "semantic";

export type SourceSetRejectionReason =
  | "archived"
  | "revoked"
  | "deleted"
  | "denied"
  | "stale"
  | "sensitivity"
  | "acl_denied"
  | "scope_mismatch"
  | "digest_mismatch"
  | "revision_mismatch"
  | "not_found";

export type SourceSetRejection = {
  refId: string;
  owner: SourceSetOwner;
  subjectId: string;
  reason: SourceSetRejectionReason;
  visibleReason: string;
};

export type SourceSetCitation = {
  refId: string;
  owner: SourceSetOwner;
  subjectId: string;
  revision: string;
  contentDigest: string;
  sourceRefs: string[];
};

export type SourceSetScoredSource = {
  ref: SourceSetRef;
  content: string;
  status: SourceSetStatus;
  indexedAt: string;
  lane: SourceSetLane;
  rank: number;
  lexicalScore: number;
  semanticSimilarity: number | null;
  freshnessScore: number;
  combinedScore: number;
};

export type SourceSetGroundedClaim = {
  claimId: string;
  statement: string;
  stance: string;
  citations: SourceSetCitation[];
  lane: SourceSetLane;
};

export type SourceSetConflictEntry = {
  kind: "claim" | "source";
  key: string;
  description: string;
  stances?: string[];
  citations: SourceSetCitation[];
};

export type SourceSetUnknown = {
  id: string;
  text: string;
};

export type SourceSetSuggestedAction = {
  id: string;
  text: string;
};

export type SourceSetEvidenceStatus = "grounded" | "partial" | "missing_sources";

export type SourceSetSemanticLaneReport =
  | { status: "unavailable"; reason: "embedding-provider-unavailable" }
  | {
      status: "available";
      providerId: string;
      dimension: number;
      similarities: Array<{ refId: string; similarity: number }>;
    }
  | { status: "error"; reason: string };

export type RuntimeMemoryShadowCandidate = {
  refId: string;
  text: string;
};

export type SourceSetRuntimeMemoryShadowReport = {
  status: "shadow-only";
  comparedCandidates: number;
  candidateRefIds: string[];
  comparisons: Array<{
    runtimeMemoryRefId: string;
    bestSourceRefId: string | null;
    lexicalOverlapScore: number;
  }>;
  runtimeMemoryEnteredActiveAnswer: false;
  note: string;
};

export type SourceSetResult = {
  schema: typeof SOURCE_SET_SCHEMA;
  query: SourceSetQuery;
  evidenceStatus: SourceSetEvidenceStatus;
  semanticLane: SourceSetSemanticLaneReport;
  retrieved: SourceSetScoredSource[];
  claims: SourceSetGroundedClaim[];
  synthesisMode: "claims" | "source-list";
  conflictSet: SourceSetConflictEntry[];
  rejections: SourceSetRejection[];
  unknowns: SourceSetUnknown[];
  suggestedNextActions: SourceSetSuggestedAction[];
  unresolvedPinnedRefs: SourceSetRejection[];
  runtimeMemoryShadow?: SourceSetRuntimeMemoryShadowReport;
};

export type RetrieveSourceSetOptions = {
  query: SourceSetQuery;
  sources: readonly SourceSetCandidate[];
  embeddingProvider?: RuntimeEmbeddingProvider;
  now?: () => Date;
  runtimeMemoryShadow?: readonly RuntimeMemoryShadowCandidate[];
};

const SENSITIVITY_ORDER: SourceSetSensitivity[] = [
  "public",
  "workspace",
  "sensitive",
  "secret-adjacent",
  "secret",
];

const EXACT_BONUS = 10_000;
const SEMANTIC_WEIGHT = 4;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export function digestSourceSetContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * Convert a KS-04 DCS-admitted resolved chat knowledge ref into a SourceSet
 * candidate. This is a derived report input only; it never becomes a store.
 */
export function sourceSetSourceFromResolvedChatKnowledgeRef(
  ref: ResolvedChatKnowledgeRef,
  options: { indexedAt?: string } = {},
): SourceSetCandidate {
  return {
    ref: {
      refId: ref.refId,
      owner: ref.owner,
      subjectKind: ref.subjectKind,
      subjectId: ref.subjectId,
      revision: ref.revision,
      contentDigest: ref.contentDigest,
      trust: ref.trust,
      sensitivity: ref.sensitivity,
      acl: { read: [] },
      provenance: {
        sourceRefs: ref.sourceRefs,
        evidenceRefs: ref.evidenceRefs,
      },
    },
    content: ref.content,
    status: "active",
    indexedAt: options.indexedAt ?? ref.materializedAt,
  };
}

const LEXICAL_STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "shall", "to", "of", "in",
  "on", "at", "by", "for", "with", "about", "as", "into", "through",
  "during", "before", "after", "above", "below", "from", "up", "down",
  "out", "off", "over", "under", "again", "further", "then", "once",
  "here", "there", "when", "where", "why", "how", "which", "who",
  "whom", "we", "all", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "s", "t", "just", "and", "but", "if", "or", "because",
  "what", "principles", "every", "show", "use",
]);

function normalizeTokens(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(
        (token) => !LEXICAL_STOP_WORDS.has(token),
      ),
    ),
  ];
}

function tokenScore(tokens: readonly string[]): number {
  let score = 0;
  for (const token of tokens) {
    score += token.length > 4 ? 2 : 1;
  }
  return score;
}

function lexicalOverlapScore(queryText: string, haystackText: string): number {
  const queryTokens = normalizeTokens(queryText);
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(normalizeTokens(haystackText));
  return tokenScore(queryTokens.filter((token) => haystack.has(token)));
}

function shapedQueryText(query: SourceSetQuery): string {
  const task = query.taskContext;
  return [
    query.text,
    task?.taskIntent,
    task?.taskType,
    ...(task?.roleTags ?? []),
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

function freshnessScore(indexedAt: string, now: Date): number {
  const parsed = Date.parse(indexedAt);
  if (!Number.isFinite(parsed)) return 0;
  const ageDays = Math.max(0, now.getTime() - parsed) / 86_400_000;
  return 1 / (1 + ageDays / 30);
}

function statusRejectionReason(status: SourceSetStatus): SourceSetRejectionReason {
  switch (status) {
    case "archived":
      return "archived";
    case "revoked":
      return "revoked";
    case "deleted":
      return "deleted";
    case "denied":
      return "denied";
    case "stale":
      return "stale";
    case "active":
      throw new Error("active sources are not rejected");
  }
}

type CandidateEvaluation =
  | { accepted: true }
  | { accepted: false; rejection: SourceSetRejection };

function evaluateCandidate(
  candidate: SourceSetCandidate,
  query: SourceSetQuery,
): CandidateEvaluation {
  const computedDigest = digestSourceSetContent(candidate.content);
  if (candidate.ref.contentDigest !== computedDigest) {
    return {
      accepted: false,
      rejection: {
        refId: candidate.ref.refId,
        owner: candidate.ref.owner,
        subjectId: candidate.ref.subjectId,
        reason: "digest_mismatch",
        visibleReason: `Source "${candidate.ref.refId}" has a content digest mismatch and cannot be used.`,
      },
    };
  }
  if (candidate.status !== "active") {
    const reason = statusRejectionReason(candidate.status);
    const reasonText = candidate.statusReason ?? `status is ${candidate.status}`;
    return {
      accepted: false,
      rejection: {
        refId: candidate.ref.refId,
        owner: candidate.ref.owner,
        subjectId: candidate.ref.subjectId,
        reason,
        visibleReason: `Source "${candidate.ref.refId}" is ${reasonText} and cannot ground an answer.`,
      },
    };
  }
  const ceiling = query.sensitivityCeiling ?? "workspace";
  if (
    SENSITIVITY_ORDER.indexOf(candidate.ref.sensitivity) >
    SENSITIVITY_ORDER.indexOf(ceiling)
  ) {
    return {
      accepted: false,
      rejection: {
        refId: candidate.ref.refId,
        owner: candidate.ref.owner,
        subjectId: candidate.ref.subjectId,
        reason: "sensitivity",
        visibleReason: `Source "${candidate.ref.refId}" has sensitivity "${candidate.ref.sensitivity}" above the "${ceiling}" ceiling.`,
      },
    };
  }
  const aclSubjects = query.aclSubjects ?? [];
  if (
    candidate.ref.acl.read.length > 0 &&
    !candidate.ref.acl.read.some((subject) => aclSubjects.includes(subject))
  ) {
    return {
      accepted: false,
      rejection: {
        refId: candidate.ref.refId,
        owner: candidate.ref.owner,
        subjectId: candidate.ref.subjectId,
        reason: "acl_denied",
        visibleReason: `Source "${candidate.ref.refId}" is ACL-restricted and the current subjects are not allowed to read it.`,
      },
    };
  }
  const queryWorkspaceId = query.taskContext?.workspaceId;
  const sourceWorkspaceId = candidate.ref.scope?.workspaceId;
  if (queryWorkspaceId && sourceWorkspaceId && queryWorkspaceId !== sourceWorkspaceId) {
    return {
      accepted: false,
      rejection: {
        refId: candidate.ref.refId,
        owner: candidate.ref.owner,
        subjectId: candidate.ref.subjectId,
        reason: "scope_mismatch",
        visibleReason: `Source "${candidate.ref.refId}" belongs to workspace "${sourceWorkspaceId}" and does not match the query workspace.`,
      },
    };
  }
  return { accepted: true };
}

function makePinnedRejection(
  pinned: SourceSetPinnedRef,
  reason: SourceSetRejectionReason,
  visibleReason: string,
): SourceSetRejection {
  return {
    refId: `${pinned.owner}:${pinned.subjectId}`,
    owner: pinned.owner,
    subjectId: pinned.subjectId,
    reason,
    visibleReason,
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  if (length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

type ExactResolution = {
  candidate: SourceSetCandidate;
  evaluation: CandidateEvaluation;
};

function resolveExact(
  pinned: SourceSetPinnedRef,
  sources: readonly SourceSetCandidate[],
  query: SourceSetQuery,
): {
  resolution?: ExactResolution;
  rejection?: SourceSetRejection;
  blockedRefIds: string[];
} {
  const matches = sources.filter(
    (source) =>
      source.ref.owner === pinned.owner && source.ref.subjectId === pinned.subjectId,
  );
  if (matches.length === 0) {
    return {
      blockedRefIds: [],
      rejection: makePinnedRejection(
        pinned,
        "not_found",
        `Pinned ref "${pinned.owner}:${pinned.subjectId}" could not be found in the source set.`,
      ),
    };
  }
  const revisionMatches = pinned.revision
    ? matches.filter((source) => source.ref.revision === pinned.revision)
    : matches;
  if (pinned.revision && revisionMatches.length === 0) {
    return {
      blockedRefIds: matches.map((source) => source.ref.refId),
      rejection: makePinnedRejection(
        pinned,
        "revision_mismatch",
        `Pinned ref "${pinned.owner}:${pinned.subjectId}" expected revision "${pinned.revision}" but no source carries that revision.`,
      ),
    };
  }
  for (const candidate of revisionMatches) {
    const evaluation = evaluateCandidate(candidate, query);
    if (!evaluation.accepted) continue;
    if (
      pinned.contentDigest &&
      pinned.contentDigest !== candidate.ref.contentDigest
    ) {
      return {
        blockedRefIds: [candidate.ref.refId],
        rejection: makePinnedRejection(
          pinned,
          "digest_mismatch",
          `Pinned ref "${pinned.owner}:${pinned.subjectId}" expected digest "${pinned.contentDigest}" but the source carries "${candidate.ref.contentDigest}".`,
        ),
      };
    }
    return { blockedRefIds: [], resolution: { candidate, evaluation } };
  }
  const firstEvaluation = evaluateCandidate(matches[0]!, query);
  if (!firstEvaluation.accepted) {
    return { blockedRefIds: [], rejection: firstEvaluation.rejection };
  }
  return {
    blockedRefIds: [],
    rejection: makePinnedRejection(
      pinned,
      "not_found",
      `Pinned ref "${pinned.owner}:${pinned.subjectId}" did not pass retrieval admission.`,
    ),
  };
}

function citationFor(candidate: SourceSetCandidate): SourceSetCitation {
  return {
    refId: candidate.ref.refId,
    owner: candidate.ref.owner,
    subjectId: candidate.ref.subjectId,
    revision: candidate.ref.revision,
    contentDigest: candidate.ref.contentDigest,
    sourceRefs: candidate.ref.provenance?.sourceRefs ?? [],
  };
}

function suggestedAction(id: string, text: string): SourceSetSuggestedAction {
  return { id, text };
}

function suggestedActionsFor(
  result: Omit<SourceSetResult, "suggestedNextActions" | "runtimeMemoryShadow">,
): SourceSetSuggestedAction[] {
  const actions = new Map<string, SourceSetSuggestedAction>();
  const add = (action: SourceSetSuggestedAction) => {
    if (!actions.has(action.id)) actions.set(action.id, action);
  };

  for (const rejection of result.rejections) {
    switch (rejection.reason) {
      case "archived":
      case "revoked":
      case "deleted":
      case "denied":
      case "stale":
        add(
          suggestedAction(
            "review-governance-status",
            "Review the rejected source status in the Knowledge Hub governance queue before reusing the reference.",
          ),
        );
        break;
      case "sensitivity":
        add(
          suggestedAction(
            "elevate-sensitivity-grant",
            "Request an explicit sensitivity grant or choose a non-sensitive source for the query.",
          ),
        );
        break;
      case "acl_denied":
        add(
          suggestedAction(
            "grant-acl-read",
            "Ask a workspace owner to grant ACL read access for the current subject.",
          ),
        );
        break;
      case "scope_mismatch":
        add(
          suggestedAction(
            "verify-workspace-scope",
            "Verify the query workspace id and the source scope before retrieval.",
          ),
        );
        break;
      case "digest_mismatch":
        add(
          suggestedAction(
            "rebuild-source-digest",
            "Rebuild the source projection and verify the content digest with the canonical owner.",
          ),
        );
        break;
      case "revision_mismatch":
      case "not_found":
        add(
          suggestedAction(
            "verify-pinned-ref",
            "Verify owner, subjectId, revision, and digest against the canonical owner before pinning the ref.",
          ),
        );
        break;
    }
  }

  if (result.evidenceStatus === "missing_sources") {
    add(
      suggestedAction(
        "broaden-retrieval",
        "Re-run with a broader task intent or review the Knowledge Hub for sources that are still missing.",
      ),
    );
  }
  if (result.conflictSet.length > 0) {
    add(
      suggestedAction(
        "resolve-conflicts",
        "Resolve the disclosed conflict set in the Knowledge Hub review queue before grounding the conflicting claims.",
      ),
    );
  }
  if (result.semanticLane.status === "unavailable") {
    add(
      suggestedAction(
        "configure-embedding-provider",
        "Configure a registered memory embedding provider through the existing adapter boundary to enable the semantic lane.",
      ),
    );
  }
  return [...actions.values()];
}

function rejectionKey(rejection: SourceSetRejection): string {
  return `${rejection.owner}:${rejection.subjectId}:${rejection.reason}`;
}

export function resolveSourceSetCitation(
  result: SourceSetResult,
  citation: SourceSetCitation,
): SourceSetCandidate | undefined {
  return result.retrieved.find(
    (entry) =>
      entry.ref.refId === citation.refId &&
      entry.ref.owner === citation.owner &&
      entry.ref.subjectId === citation.subjectId &&
      entry.ref.revision === citation.revision &&
      entry.ref.contentDigest === citation.contentDigest,
  );
}

export function packSourceSetForDcs(result: SourceSetResult): string {
  const lines: string[] = [
    `[SourceSet/v1 evidenceStatus=${result.evidenceStatus} semanticLane=${result.semanticLane.status}]`,
  ];
  if (result.claims.length > 0) {
    lines.push("Grounded claims:");
    for (const claim of result.claims) {
      lines.push(`- ${claim.statement} (stance: ${claim.stance})`);
      for (const citation of claim.citations) {
        lines.push(
          `  citation: owner=${citation.owner} subjectId=${citation.subjectId} revision=${citation.revision} digest=${citation.contentDigest}`,
        );
      }
    }
  } else {
    lines.push("Grounded claims: none");
  }
  lines.push("Sources:");
  for (const entry of result.retrieved) {
    lines.push(
      `- ${entry.ref.refId} lane=${entry.lane} status=${entry.status} revision=${entry.ref.revision}`,
    );
  }
  if (result.conflictSet.length > 0) {
    lines.push("Conflicts (both sides disclosed, not silently picked):");
    for (const conflict of result.conflictSet) {
      lines.push(`- ${conflict.key}: ${conflict.description}`);
    }
  }
  if (result.unknowns.length > 0) {
    lines.push("Unknowns:");
    for (const unknown of result.unknowns) lines.push(`- ${unknown.text}`);
  }
  if (result.suggestedNextActions.length > 0) {
    lines.push("Suggested next actions:");
    for (const action of result.suggestedNextActions) {
      lines.push(`- ${action.id}: ${action.text}`);
    }
  }
  lines.push("Confidence: not emitted (evidenceStatus is computed from admitted evidence only)");
  return lines.join("\n");
}

export async function retrieveSourceSet(
  options: RetrieveSourceSetOptions,
): Promise<SourceSetResult> {
  const query = options.query;
  const now = options.now?.() ?? new Date();
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT)),
  );
  const rejections: SourceSetRejection[] = [];
  const unresolvedPinnedRefs: SourceSetRejection[] = [];
  const mismatchBlockedRefIds = new Set<string>();
  const exactByRefId = new Set<string>();
  const exactOrderByRefId = new Map<string, number>();

  (query.pinnedRefs ?? []).forEach((pinned, index) => {
    const resolved = resolveExact(pinned, options.sources, query);
    for (const blockedRefId of resolved.blockedRefIds) {
      mismatchBlockedRefIds.add(blockedRefId);
    }
    if (resolved.rejection) {
      unresolvedPinnedRefs.push(resolved.rejection);
      rejections.push(resolved.rejection);
    } else if (resolved.resolution) {
      exactByRefId.add(resolved.resolution.candidate.ref.refId);
      exactOrderByRefId.set(resolved.resolution.candidate.ref.refId, index);
    }
  });

  const accepted: SourceSetCandidate[] = [];
  for (const candidate of options.sources) {
    if (mismatchBlockedRefIds.has(candidate.ref.refId)) continue;
    const evaluation = evaluateCandidate(candidate, query);
    if (evaluation.accepted) {
      accepted.push(candidate);
    } else {
      rejections.push(evaluation.rejection);
    }
  }

  const shapedQuery = shapedQueryText(query);
  const lexicalByRefId = new Map<string, number>();
  for (const candidate of accepted) {
    lexicalByRefId.set(
      candidate.ref.refId,
      lexicalOverlapScore(shapedQuery, candidate.content),
    );
  }

  let semanticLane: SourceSetSemanticLaneReport;
  let semanticSimilarityByRefId = new Map<string, number>();
  if (!options.embeddingProvider) {
    semanticLane = { status: "unavailable", reason: "embedding-provider-unavailable" };
  } else {
    try {
      const provider = options.embeddingProvider;
      const queryVector = await provider.embedQuery(shapedQuery);
      const contentVectors = await provider.embedBatch(
        accepted.map((candidate) => candidate.content),
      );
      const similarities = accepted.map((candidate, index) => {
        const similarity = cosineSimilarity(
          queryVector,
          contentVectors[index] ?? [],
        );
        return { refId: candidate.ref.refId, similarity };
      });
      semanticSimilarityByRefId = new Map(
        similarities.map((entry) => [entry.refId, entry.similarity]),
      );
      semanticLane = {
        status: "available",
        providerId: provider.id,
        dimension: provider.dimension,
        similarities,
      };
    } catch (error) {
      semanticLane = {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const scored = accepted.map((candidate) => {
    const lexicalScore = lexicalByRefId.get(candidate.ref.refId) ?? 0;
    const semanticSimilarity =
      semanticLane.status === "available"
        ? (semanticSimilarityByRefId.get(candidate.ref.refId) ?? 0)
        : null;
    const exactBonus = exactByRefId.has(candidate.ref.refId) ? EXACT_BONUS : 0;
    const combinedScore =
      lexicalScore +
      exactBonus +
      (semanticSimilarity === null ? 0 : semanticSimilarity * SEMANTIC_WEIGHT);
    const lane: SourceSetLane = exactBonus > 0
      ? "exact"
      : semanticSimilarity !== null &&
          semanticSimilarity * SEMANTIC_WEIGHT > lexicalScore
        ? "semantic"
        : "lexical";
    return {
      candidate,
      lexicalScore,
      semanticSimilarity,
      freshnessScore: freshnessScore(candidate.indexedAt, now),
      combinedScore,
      lane,
    };
  });

  scored.sort((left, right) => {
    if (right.combinedScore !== left.combinedScore) {
      return right.combinedScore - left.combinedScore;
    }
    if (right.freshnessScore !== left.freshnessScore) {
      return right.freshnessScore - left.freshnessScore;
    }
    const leftExactOrder = exactOrderByRefId.get(left.candidate.ref.refId) ?? Number.MAX_SAFE_INTEGER;
    const rightExactOrder = exactOrderByRefId.get(right.candidate.ref.refId) ?? Number.MAX_SAFE_INTEGER;
    if (leftExactOrder !== rightExactOrder) {
      return leftExactOrder - rightExactOrder;
    }
    return left.candidate.ref.refId < right.candidate.ref.refId
      ? -1
      : left.candidate.ref.refId > right.candidate.ref.refId
        ? 1
        : 0;
  });

  const isRetrievable = (entry: (typeof scored)[number]) =>
    entry.combinedScore > 0 &&
    (exactByRefId.has(entry.candidate.ref.refId) ||
      entry.lexicalScore > 0 ||
      (entry.semanticSimilarity ?? 0) > 0);

  const retrieved = scored
    .filter(isRetrievable)
    .slice(0, limit)
    .map((entry, index) => ({
      ref: entry.candidate.ref,
      content: entry.candidate.content,
      status: entry.candidate.status,
      indexedAt: entry.candidate.indexedAt,
      lane: entry.lane,
      rank: index + 1,
      lexicalScore: entry.lexicalScore,
      semanticSimilarity: entry.semanticSimilarity,
      freshnessScore: entry.freshnessScore,
      combinedScore: entry.combinedScore,
    }));

  const relevantPool = scored.filter(isRetrievable);
  const conflictSet: SourceSetConflictEntry[] = [];
  const conflictClaimIds = new Set<string>();

  const claimBuckets = new Map<string, Map<string, SourceSetCandidate[]>>();
  for (const entry of relevantPool) {
    for (const claim of entry.candidate.claims ?? []) {
      const byStance = claimBuckets.get(claim.claimId) ?? new Map<string, SourceSetCandidate[]>();
      const list = byStance.get(claim.stance) ?? [];
      list.push(entry.candidate);
      byStance.set(claim.stance, list);
      claimBuckets.set(claim.claimId, byStance);
    }
  }
  for (const [claimId, byStance] of claimBuckets) {
    if (byStance.size <= 1) continue;
    conflictClaimIds.add(claimId);
    const stances = [...byStance.keys()].sort();
    const citations = [...byStance.values()]
      .flat()
      .toSorted((left, right) => left.ref.refId.localeCompare(right.ref.refId))
      .map(citationFor);
    conflictSet.push({
      kind: "claim",
      key: `claim:${claimId}`,
      description: `Conflicting stances for claim "${claimId}": ${stances.join(" vs ")}.`,
      stances,
      citations,
    });
  }

  const sourceConflictBuckets = new Map<string, SourceSetCandidate[]>();
  for (const entry of relevantPool) {
    for (const key of entry.candidate.conflictKeys ?? []) {
      const list = sourceConflictBuckets.get(key) ?? [];
      list.push(entry.candidate);
      sourceConflictBuckets.set(key, list);
    }
  }
  for (const [key, candidates] of sourceConflictBuckets) {
    const distinctDigests = new Set(candidates.map((candidate) => candidate.ref.contentDigest));
    if (candidates.length <= 1 || distinctDigests.size <= 1) continue;
    conflictSet.push({
      kind: "source",
      key: `source:${key}`,
      description: `Sources disagree on conflict key "${key}".`,
      citations: candidates
        .toSorted((left, right) => left.ref.refId.localeCompare(right.ref.refId))
        .map(citationFor),
    });
  }
  conflictSet.sort((left, right) => left.key.localeCompare(right.key));

  const claims: SourceSetGroundedClaim[] = [];
  for (const [claimId, byStance] of [...claimBuckets.entries()].toSorted((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    if (conflictClaimIds.has(claimId)) continue;
    const stance = [...byStance.keys()][0]!;
    const candidates = byStance.get(stance) ?? [];
    const ordered = candidates.toSorted((left, right) => {
      const leftRank = retrieved.find((entry) => entry.ref.refId === left.ref.refId)?.rank ?? 999;
      const rightRank = retrieved.find((entry) => entry.ref.refId === right.ref.refId)?.rank ?? 999;
      return leftRank - rightRank || left.ref.refId.localeCompare(right.ref.refId);
    });
    const firstClaim = ordered[0]?.claims?.find((claim) => claim.claimId === claimId);
    const firstRetrieved = retrieved.find((entry) => entry.ref.refId === ordered[0]?.ref.refId);
    if (!firstClaim || !firstRetrieved) continue;
    claims.push({
      claimId,
      statement: firstClaim.statement,
      stance: firstClaim.stance,
      citations: ordered.map(citationFor),
      lane: firstRetrieved.lane,
    });
  }

  const evidenceStatus: SourceSetEvidenceStatus =
    retrieved.length === 0
      ? "missing_sources"
      : conflictSet.length > 0 || unresolvedPinnedRefs.length > 0
        ? "partial"
        : "grounded";

  const unknowns: SourceSetUnknown[] = [];
  for (const rejection of unresolvedPinnedRefs) {
    unknowns.push({
      id: `pinned:${rejection.owner}:${rejection.subjectId}`,
      text: rejection.visibleReason,
    });
  }
  if (retrieved.length === 0) {
    unknowns.push({
      id: "query-no-sources",
      text: `No admitted source resolves query "${query.text}".`,
    });
  }

  const resultWithoutExtras: Omit<
    SourceSetResult,
    "suggestedNextActions" | "runtimeMemoryShadow"
  > = {
    schema: SOURCE_SET_SCHEMA,
    query,
    evidenceStatus,
    semanticLane,
    retrieved,
    claims,
    synthesisMode: claims.length > 0 ? "claims" : "source-list",
    conflictSet,
    rejections: [...rejections].filter(
      (rejection, index, all) =>
        all.findIndex((entry) => rejectionKey(entry) === rejectionKey(rejection)) === index,
    ),
    unknowns,
    unresolvedPinnedRefs,
  };

  const runtimeMemoryShadow = buildRuntimeMemoryShadowReport(
    options.runtimeMemoryShadow ?? [],
    retrieved,
  );

  return {
    ...resultWithoutExtras,
    suggestedNextActions: suggestedActionsFor(resultWithoutExtras),
    ...(runtimeMemoryShadow ? { runtimeMemoryShadow } : {}),
  };
}

function buildRuntimeMemoryShadowReport(
  candidates: readonly RuntimeMemoryShadowCandidate[],
  retrieved: readonly SourceSetScoredSource[],
): SourceSetRuntimeMemoryShadowReport | undefined {
  if (candidates.length === 0) return undefined;
  return {
    status: "shadow-only",
    comparedCandidates: candidates.length,
    candidateRefIds: candidates.map((candidate) => candidate.refId),
    comparisons: candidates.map((candidate) => {
      let bestSourceRefId: string | null = null;
      let bestScore = 0;
      for (const source of retrieved) {
        const score = lexicalOverlapScore(candidate.text, source.content);
        if (score > bestScore) {
          bestScore = score;
          bestSourceRefId = source.ref.refId;
        }
      }
      return {
        runtimeMemoryRefId: candidate.refId,
        bestSourceRefId,
        lexicalOverlapScore: bestScore,
      };
    }),
    runtimeMemoryEnteredActiveAnswer: false,
    note:
      "Runtime Memory candidates were compared for shadow observability only and did not participate in SourceSet admission, ranking, claims, or citations.",
  };
}
