import type {
  ContextPack,
  ContextPackBucketName,
  ContextPackBudget,
  ContextPackBuckets,
  MemoryCard,
  MemoryInjectionCandidateExplain,
  MemoryPhaseTag,
} from "./types.js";
import { isMemoryCardExpired } from "./memory-card.js";
import {
  classifyInjectionCandidate,
  MEMORY_CONTEXT_POLICY_VERSION,
  roleAppliesToCard,
  semanticMemoryType,
} from "./memory-policy.js";

export const DEFAULT_CONTEXT_PACK_BUDGET: ContextPackBudget = {
  hardConstraints: 500,
  rolePlaybook: 600,
  projectFacts: 600,
  teamHandoffs: 400,
  recentEpisodes: 500,
  openConflicts: 400,
  taskState: 1000,
  total: 3000,
};

const BUCKET_ORDER: readonly ContextPackBucketName[] = [
  "hardConstraints",
  "rolePlaybook",
  "projectFacts",
  "teamHandoffs",
  "recentEpisodes",
  "openConflicts",
  "taskState",
];

export type ContextPackInput = {
  memories?: MemoryCard[];
  roleName?: string;
  phase?: MemoryPhaseTag;
  taskState?: string;
  openConflicts?: string[];
  openConflictCardIds?: string[];
  budget?: Partial<ContextPackBudget>;
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function bucketForMemory(card: MemoryCard, roleName?: string): ContextPackBucketName {
  if (card.sensitivity === "secret" || card.sensitivity === "secret_adjacent") {
    return "hardConstraints";
  }
  const type = semanticMemoryType(card.type);
  if (type === "constraint") return "hardConstraints";
  if (type === "handoff") return "teamHandoffs";
  if (type === "fact" || type === "decision") return "projectFacts";
  if (type === "procedure" || type === "preference" || type === "risk") return "rolePlaybook";
  if (type === "episode") return "recentEpisodes";
  if (card.phaseTags?.includes("handoff")) {
    return "teamHandoffs";
  }
  if (card.type === "project_fact") {
    return "projectFacts";
  }
  if (card.type === "procedural") {
    return "rolePlaybook";
  }
  if (card.type === "episodic" || card.scope === "session") {
    return "recentEpisodes";
  }
  if (roleName && card.roleTags.includes(roleName)) {
    return "rolePlaybook";
  }
  return "projectFacts";
}

const SCOPE_WEIGHTS: Record<string, number> = {
  user: 1,
  task: 0.9,
  session: 0.86,
  workspace: 0.78,
  project: 0.72,
  agent: 0.62,
  team: 0.56,
  role: 0.5,
  global: 0.4,
};

/**
 * Keyword overlap between card content and task state. ASCII words (3+
 * chars) match as before; CJK matches by bigram intersection (TF-0114 /
 * T-P0-6). The previous split kept a whole Chinese run as a single token and
 * required a verbatim whole-run `includes`, which made the taskMatch
 * thresholds (0.35 / 0.75) de facto unreachable for Chinese text.
 */
export function keywordOverlap(content: string, task?: string): number {
  if (!task?.trim()) return 0;
  const asciiWords = task.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  const cjkBigrams: string[] = [];
  for (const run of task.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      cjkBigrams.push(run.slice(i, i + 2));
    }
  }
  const words = new Set<string>([...asciiWords, ...cjkBigrams]);
  if (words.size === 0) return 0;
  const normalized = content.toLowerCase();
  let matches = 0;
  for (const word of words) {
    if (normalized.includes(word)) matches += 1;
  }
  return Math.min(1, matches / Math.max(1, Math.min(words.size, 6)));
}

function recencyWeight(card: MemoryCard, now: Date): { value: number; stale: boolean } {
  const updated = Date.parse(card.updatedAt ?? card.createdAt);
  if (!Number.isFinite(updated)) return { value: 0, stale: false };
  const ageDays = Math.max(0, (now.getTime() - updated) / 86_400_000);
  return { value: Math.max(0, 1 - ageDays / 90), stale: ageDays > 180 };
}

function redactMemoryContent(card: MemoryCard): string {
  if (card.sensitivity !== "secret_adjacent") return card.content;
  return card.content
    .replace(/\b(sk-[a-z0-9_-]{8,})\b/gi, "[redacted-key]")
    .replace(/\b(token|password|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

export function selectMemoryForContextPack(input: ContextPackInput): {
  selected: Array<{ card: MemoryCard; bucket: ContextPackBucketName; text: string; score: number }>;
  explanations: MemoryInjectionCandidateExplain[];
} {
  const now = new Date();
  const conflictCardIds = new Set(input.openConflictCardIds ?? []);
  const selected: Array<{ card: MemoryCard; bucket: ContextPackBucketName; text: string; score: number }> = [];
  const explanations: MemoryInjectionCandidateExplain[] = [];
  const classRank = { must: 3, should: 2, may: 1, never: 0 } as const;
  for (const card of input.memories ?? []) {
    const penalties: string[] = [];
    const taskMatch = keywordOverlap(card.content, input.taskState);
    const roleApplies = roleAppliesToCard(card, input.roleName);
    const roleMatch = input.roleName && roleApplies ? 1 : (card.applicableRoles?.length ?? card.roleTags.length) > 0 ? 0.2 : 0.45;
    const phaseMatch = input.phase && card.phaseTags?.includes(input.phase) ? 1 : 0;
    const recency = recencyWeight(card, now);
    const conflict = conflictCardIds.has(card.id);
    const expired = isMemoryCardExpired(card, now);
    const classification = classifyInjectionCandidate({
      card,
      roleName: input.roleName,
      phase: input.phase,
      taskMatch,
      conflict,
      expired,
    });
    let selectedCandidate =
      classification.injectionClass === "must" ||
      classification.injectionClass === "should" ||
      (classification.injectionClass === "may" && card.status === "active" && taskMatch >= 0.35) ||
      (card.status === "cold" && taskMatch >= 0.75);
    if (card.sensitivity === "secret") {
      penalties.push("sensitivity");
      selectedCandidate = false;
    }
    if (!roleApplies && classification.injectionClass !== "must") {
      penalties.push("role");
      selectedCandidate = false;
    }
    if (conflict) penalties.push("conflict");
    if (recency.stale) penalties.push("stale");
    if (expired) penalties.push("stale");
    const score = Number((
      (SCOPE_WEIGHTS[card.scope] ?? 0.4) * 0.18 +
      roleMatch * 0.18 +
      phaseMatch * 0.1 +
      taskMatch * 0.14 +
      card.importance * 0.25 +
      card.confidence * 0.15 +
      recency.value * 0.06 +
      Math.min(1, card.accessCount / 10) * 0.04 -
      (card.sensitivity === "secret_adjacent" ? 0.1 : 0) -
      (conflict ? 0.4 : 0) -
      (recency.stale ? 0.15 : 0) +
      classRank[classification.injectionClass] * 0.2
    ).toFixed(4));
    const bucket = conflict ? "openConflicts" : bucketForMemory(card, input.roleName);
    const reason = [
      `class=${classification.injectionClass}`,
      `scope=${card.scope}`,
      `role=${roleMatch.toFixed(2)}`,
      `phase=${phaseMatch.toFixed(2)}`,
      `task=${taskMatch.toFixed(2)}`,
      `importance=${card.importance.toFixed(2)}`,
      `confidence=${card.confidence.toFixed(2)}`,
    ].join("; ");
    explanations.push({
      cardId: card.id,
      score,
      selected: selectedCandidate,
      bucket: selectedCandidate ? bucket : undefined,
      reason: `${classification.reason} ${reason}`,
      penalties,
      injectionClass: classification.injectionClass,
      whatWouldSelect: classification.whatWouldSelect,
      truncatedReason: selectedCandidate ? undefined : penalties.includes("sensitivity") ? "sensitivity" : penalties.includes("stale") ? "stale" : undefined,
    });
    if (selectedCandidate) {
      selected.push({ card, bucket, text: redactMemoryContent(card), score });
    }
  }
  selected.sort((left, right) => {
    const leftClass = explanations.find((entry) => entry.cardId === left.card.id)?.injectionClass ?? "may";
    const rightClass = explanations.find((entry) => entry.cardId === right.card.id)?.injectionClass ?? "may";
    return classRank[rightClass] - classRank[leftClass] || right.score - left.score || right.card.importance - left.card.importance;
  });
  return { selected, explanations };
}

function appendWithinBudget(bucket: string[], text: string, maxTokens: number): { tokens: number; appended: boolean } {
  const used = bucket.reduce((sum, item) => sum + estimateTokens(item), 0);
  const nextTokens = estimateTokens(text);
  if (used + nextTokens > maxTokens) {
    return { tokens: used, appended: false };
  }
  bucket.push(text);
  return { tokens: used + nextTokens, appended: true };
}

export function buildContextPack(input: ContextPackInput): ContextPack {
  const budget: ContextPackBudget = { ...DEFAULT_CONTEXT_PACK_BUDGET, ...input.budget };
  const buckets: ContextPackBuckets = {
    hardConstraints: [],
    rolePlaybook: [],
    projectFacts: [],
    teamHandoffs: [],
    recentEpisodes: [],
    openConflicts: [],
    taskState: [],
  };
  let truncated = false;
  const selection = selectMemoryForContextPack(input);
  const explanations = selection.explanations.map((entry) => ({ ...entry }));
  const explanationByCardId = new Map(explanations.map((entry) => [entry.cardId, entry]));
  const bucketItemToCardId = new Map<string, string>();
  for (const item of selection.selected) {
    const appended = appendWithinBudget(buckets[item.bucket], item.text, budget[item.bucket]).appended;
    truncated ||= !appended;
    if (!appended) {
      const explanation = explanationByCardId.get(item.card.id);
      if (explanation) {
        explanation.selected = false;
        explanation.truncatedReason = "bucket_budget";
      }
    } else {
      bucketItemToCardId.set(item.text, item.card.id);
    }
  }
  if (input.taskState) {
    truncated ||= !appendWithinBudget(buckets.taskState, input.taskState, budget.taskState).appended;
  }
  for (const conflict of input.openConflicts ?? []) {
    truncated ||= !appendWithinBudget(buckets.openConflicts, conflict, budget.openConflicts).appended;
  }
  const estimatedTokens = {
    hardConstraints: 0,
    rolePlaybook: 0,
    projectFacts: 0,
    teamHandoffs: 0,
    recentEpisodes: 0,
    openConflicts: 0,
    taskState: 0,
    total: 0,
  };
  for (const bucket of BUCKET_ORDER) {
    estimatedTokens[bucket] = buckets[bucket].reduce((sum, item) => sum + estimateTokens(item), 0);
    estimatedTokens.total += estimatedTokens[bucket];
  }
  if (estimatedTokens.total > budget.total) {
    truncated = true;
    for (const bucket of [...BUCKET_ORDER].reverse()) {
      while (estimatedTokens.total > budget.total && buckets[bucket].length > 0) {
        const removed = buckets[bucket].pop() ?? "";
        const removedTokens = estimateTokens(removed);
        estimatedTokens[bucket] -= removedTokens;
        estimatedTokens.total -= removedTokens;
        const cardId = bucketItemToCardId.get(removed);
        const explanation = cardId ? explanationByCardId.get(cardId) : undefined;
        if (explanation) {
          explanation.selected = false;
          explanation.truncatedReason = "total_budget";
        }
      }
    }
  }
  return {
    budget,
    buckets,
    estimatedTokens,
    truncated,
    policyVersion: MEMORY_CONTEXT_POLICY_VERSION,
    candidateExplanations: explanations,
  };
}

export function renderContextPack(pack: ContextPack): string {
  const labels: Record<ContextPackBucketName, string> = {
    hardConstraints: "Hard Constraints",
    rolePlaybook: "Role Playbook",
    projectFacts: "Project Facts",
    teamHandoffs: "Team Handoffs",
    recentEpisodes: "Recent Episodes",
    openConflicts: "Open Conflicts",
    taskState: "Task State",
  };
  return BUCKET_ORDER.flatMap((bucket) => {
    const items = pack.buckets[bucket];
    if (items.length === 0) {
      return [];
    }
    return [`### ${labels[bucket]}`, ...items.map((item) => `- ${item}`)];
  }).join("\n");
}
