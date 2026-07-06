// Routing Memo Store (Area 3 §3.1) — cross-run routing reuse.
//
// Records every orchestration's routing decision and outcome; on the next plan,
// surfaces "you routed a similar task this way and it went well/poorly" as
// (a) an additive scoring signal (active phase) or (b) a shadow diagnostic
// reason (shadow phase). This is deliberately a *memo*, not a learned policy —
// a single-user local app has tens-to-hundreds of runs, far below ML sample
// sizes.
//
// Storage: append-only JSONL under the workspace
// (`.clawx/orchestration/routing-memos.jsonl`), capped at the last 500 memos
// (compacted on load). No DB (map §8 constraint). Reuses `WorkerQualityScore`
// and `graphStatus` that `runOrchestrationObserved` already computes.
//
// Privacy: memos stay per-workspace on disk, never leave the machine, and store
// token digests rather than raw task text; staleness self-corrects because
// newer memos on the same digest outweigh older ones (recency-weighted
// similarity).
//
// Error handling: unreadable/corrupt memo file → skip recall entirely, plan
// proceeds exactly as today. Record failures are best-effort try/catch.

import { mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RoleRouteMode } from "./role-router.js";

export type RoutingMemoGraphStatus = "pending" | "completed" | "partial" | "failed";

export type RoutingMemoQuality = "good" | "needs_attention" | "poor_attempt";
export type RoutingMemoShadowOutcome = "same" | "memo_better" | "memo_worse" | "unknown";

export type RoutingMemoShadowObservation = {
  mode: "shadow";
  actualLeadRole: string;
  memoLeadRole: string;
  diverged: boolean;
  outcome: RoutingMemoShadowOutcome;
  similarity?: number;
};

export type RoutingMemo = {
  id: string;
  createdAt: string;
  workspaceDir?: string;
  /** Normalized keyword/file-token set (no raw task text needed for privacy). */
  taskDigest: string[];
  mode: RoleRouteMode;
  leadRole: string;
  workerRoles: string[];
  templateId?: string;
  outcome: {
    graphStatus: RoutingMemoGraphStatus;
    /** Worst worker quality score across the run; undefined when not scored. */
    qualityOverall?: RoutingMemoQuality;
    repairCount: number;
  };
  shadowObservation?: RoutingMemoShadowObservation;
};

export type RoutingMemoMatch = {
  memo: RoutingMemo;
  /** Jaccard similarity over task digests, range [0, 1]. */
  similarity: number;
};

export type RoutingMemoPilotMode = "off" | "shadow" | "active";
export type RoutingMemoAuthority = "off" | "shadow" | "active";

export type OrchestrationQualityState = {
  source: "scorecard" | "ordinary_orchestration" | "shadow" | string;
  qualityOverall?: RoutingMemoQuality | null;
  scorecardBacked?: boolean;
};

export type RoutingMemoAuthorityResult = {
  pilotMode: RoutingMemoPilotMode;
  authority: RoutingMemoAuthority;
  reason: "pilot-off" | "pilot-shadow" | "missing-scorecard-quality" | "scorecard-quality-present";
};

export type RoutingMemoDashboard = {
  pilotMode: RoutingMemoPilotMode;
  authority: RoutingMemoAuthority;
  authorityReason: RoutingMemoAuthorityResult["reason"];
  storagePath?: string;
  sampleCount: number;
  outcomes: {
    graphStatus: Record<RoutingMemoGraphStatus, number>;
    qualityOverall: Record<RoutingMemoQuality, number>;
  };
  shadow: {
    sampleCount: number;
    divergenceCount: number;
    outcomes: Record<RoutingMemoShadowOutcome, number>;
    divergenceSuccessRate: number | null;
  };
  activeGate: {
    eligible: boolean;
    reasons: string[];
    minShadowSamples: number;
    minDivergenceSuccessRate: number;
    shadowSampleCount: number;
    divergenceCount: number;
    divergenceSuccessRate: number | null;
  };
  recentSamples: Array<{
    id: string;
    createdAt: string;
    leadRole: string;
    graphStatus: RoutingMemoGraphStatus;
    qualityOverall?: RoutingMemoQuality;
    shadow?: Pick<RoutingMemoShadowObservation, "actualLeadRole" | "memoLeadRole" | "diverged" | "outcome" | "similarity">;
  }>;
};

export const DEFAULT_ROUTING_MEMO_PILOT_MODE: RoutingMemoPilotMode = "off";
export const ROUTING_MEMO_FILE_NAME = "routing-memos.jsonl";
export const ROUTING_MEMO_MAX_ENTRIES = 500;
export const ROUTING_MEMO_RECALL_SIMILARITY_THRESHOLD = 0.5;
export const ROUTING_MEMO_ACTIVE_GATE_MIN_SHADOW_SAMPLES = 20;
export const ROUTING_MEMO_ACTIVE_GATE_MIN_DIVERGENCE_SUCCESS_RATE = 0.7;

/**
 * Resolve the routing memo pilot mode from runtime config.
 *
 * Defaults to 'off'. Accepts `runtime.orchestration.routingMemoPilot` with
 * values 'off' | 'shadow' | 'active'. Unknown values fall back to 'off'.
 *
 * Shadow phase (§6): memos are recorded and recalled, and the would-be score
 * adjustment is written into `RouteDiagnostics.reasons` as `memo-shadow:...`
 * but does NOT alter scores.
 *
 * Active phase: memos influence scores (±2 bounded, §3.1). Gate to active:
 * ≥20 shadow runs; shadow-divergent recommendations would have equaled-or-
 * improved outcomes in ≥70% of divergences.
 */
export function resolveRoutingMemoPilotMode(value: unknown): RoutingMemoPilotMode {
  const record = isRecord(value) ? value : undefined;
  const runtime = isRecord(record?.runtime) ? record.runtime : undefined;
  const orchestration = isRecord(runtime?.orchestration) ? runtime.orchestration : undefined;
  const pilot = orchestration?.routingMemoPilot;
  if (pilot === "shadow" || pilot === "active") return pilot;
  return DEFAULT_ROUTING_MEMO_PILOT_MODE;
}

export function resolveRoutingMemoAuthority(params: {
  pilotMode: RoutingMemoPilotMode;
  qualityState?: OrchestrationQualityState | null;
}): RoutingMemoAuthorityResult {
  if (params.pilotMode === "off") {
    return { pilotMode: params.pilotMode, authority: "off", reason: "pilot-off" };
  }
  if (params.pilotMode === "shadow") {
    return { pilotMode: params.pilotMode, authority: "shadow", reason: "pilot-shadow" };
  }
  const quality = params.qualityState;
  if (quality?.scorecardBacked === true && quality.source === "scorecard" && quality.qualityOverall) {
    return { pilotMode: params.pilotMode, authority: "active", reason: "scorecard-quality-present" };
  }
  return { pilotMode: params.pilotMode, authority: "shadow", reason: "missing-scorecard-quality" };
}

/**
 * Compute a task digest: lowercased keyword/file-token set. Strip punctuation,
 * split on whitespace, drop common stopwords and tokens shorter than 2 chars.
 * No raw task text is stored — only the digest.
 */
export function computeTaskDigest(task: string, fileHints: readonly string[] = []): string[] {
  const tokens = new Set<string>();
  const combined = `${task} ${fileHints.join(" ")}`.toLowerCase();
  const rough = combined.split(/[^a-z0-9\u4e00-\u9fff]+/u);
  for (const token of rough) {
    if (token.length >= 2 && !STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return [...tokens].sort();
}

/**
 * Jaccard similarity over two task digests. Returns 0 when either is empty.
 */
export function taskDigestSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Append a routing memo to the workspace's JSONL store. Best-effort: any
 * filesystem error is swallowed and logged via the optional `log` callback.
 * No-op when `workspaceDir` is undefined (memo recording is workspace-scoped).
 */
export function recordRoutingMemo(
  memo: RoutingMemo,
  workspaceDir: string | undefined,
  log?: (message: string, context?: unknown) => void,
): void {
  if (!workspaceDir) return;
  const filePath = resolveMemoFilePath(workspaceDir);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(memo)}\n`, "utf8");
  } catch (err) {
    log?.("[routing-memo] record failed (best-effort, swallowed)", { err: String(err) });
  }
}

/**
 * Recall up to `limit` (default 5) memos whose task digest similarity to the
 * query digest is ≥ `ROUTING_MEMO_RECALL_SIMILARITY_THRESHOLD`, sorted by
 * descending similarity then descending recency. Returns an empty array when
 * `workspaceDir` is undefined, the file is missing, or any read error occurs
 * (degrade to today's routing).
 *
 * The store is compacted to `ROUTING_MEMO_MAX_ENTRIES` on load (keeping the
 * most recent entries) — compaction is best-effort and writes back to disk.
 */
export function recallRoutingMemos(
  taskDigest: readonly string[],
  workspaceDir: string | undefined,
  options: { limit?: number; threshold?: number; log?: (message: string, context?: unknown) => void } = {},
): RoutingMemoMatch[] {
  if (!workspaceDir || taskDigest.length === 0) return [];
  const filePath = resolveMemoFilePath(workspaceDir);
  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf8");
  } catch {
    // Missing file or unreadable → treat as empty store.
    return [];
  }
  const memos = parseMemos(rawContent, options.log);
  if (memos.length === 0) return [];

  // Best-effort compaction: keep only the most recent ROUTING_MEMO_MAX_ENTRIES.
  compactMemosFile(filePath, memos, options.log);

  const threshold = options.threshold ?? ROUTING_MEMO_RECALL_SIMILARITY_THRESHOLD;
  const limit = options.limit ?? 5;
  const matches: RoutingMemoMatch[] = [];
  for (const memo of memos) {
    const similarity = taskDigestSimilarity(taskDigest, memo.taskDigest);
    if (similarity >= threshold) {
      matches.push({ memo, similarity });
    }
  }
  matches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    // Tie-break by recency (newer first).
    return b.memo.createdAt.localeCompare(a.memo.createdAt);
  });
  return matches.slice(0, limit);
}

export function readRoutingMemoDashboard(
  workspaceDir: string | undefined,
  cfg: unknown,
  options: { qualityState?: OrchestrationQualityState | null; limit?: number } = {},
): RoutingMemoDashboard {
  const pilotMode = resolveRoutingMemoPilotMode(cfg);
  const authority = resolveRoutingMemoAuthority({ pilotMode, qualityState: options.qualityState ?? null });
  const memos = readAllRoutingMemos(workspaceDir);
  const graphStatus = zeroGraphStatusCounts();
  const qualityOverall = zeroQualityCounts();
  const shadowOutcomes = zeroShadowOutcomeCounts();
  let shadowSampleCount = 0;
  let divergenceCount = 0;
  for (const memo of memos) {
    graphStatus[memo.outcome.graphStatus] += 1;
    if (memo.outcome.qualityOverall) {
      qualityOverall[memo.outcome.qualityOverall] += 1;
    }
    const shadow = memo.shadowObservation;
    if (shadow) {
      shadowSampleCount += 1;
      shadowOutcomes[shadow.outcome] += 1;
      if (shadow.diverged) divergenceCount += 1;
    }
  }
  const divergenceSuccessRate = divergenceCount > 0
    ? shadowOutcomes.memo_better / divergenceCount
    : null;
  const gateReasons: string[] = [];
  if (shadowSampleCount < ROUTING_MEMO_ACTIVE_GATE_MIN_SHADOW_SAMPLES) {
    gateReasons.push("shadow-sample-count-below-threshold");
  }
  if (divergenceSuccessRate != null && divergenceSuccessRate < ROUTING_MEMO_ACTIVE_GATE_MIN_DIVERGENCE_SUCCESS_RATE) {
    gateReasons.push("divergence-success-rate-below-threshold");
  }
  if (authority.authority !== "active") {
    gateReasons.push(authority.reason);
  }
  const eligible = gateReasons.length === 0;
  const recentSamples = [...memos]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.limit ?? 5)
    .map((memo) => ({
      id: memo.id,
      createdAt: memo.createdAt,
      leadRole: memo.leadRole,
      graphStatus: memo.outcome.graphStatus,
      ...(memo.outcome.qualityOverall ? { qualityOverall: memo.outcome.qualityOverall } : {}),
      ...(memo.shadowObservation
        ? {
            shadow: {
              actualLeadRole: memo.shadowObservation.actualLeadRole,
              memoLeadRole: memo.shadowObservation.memoLeadRole,
              diverged: memo.shadowObservation.diverged,
              outcome: memo.shadowObservation.outcome,
              ...(typeof memo.shadowObservation.similarity === "number"
                ? { similarity: memo.shadowObservation.similarity }
                : {}),
            },
          }
        : {}),
    }));
  return {
    pilotMode,
    authority: authority.authority,
    authorityReason: authority.reason,
    storagePath: workspaceDir ? resolveMemoFilePath(workspaceDir) : undefined,
    sampleCount: memos.length,
    outcomes: { graphStatus, qualityOverall },
    shadow: {
      sampleCount: shadowSampleCount,
      divergenceCount,
      outcomes: shadowOutcomes,
      divergenceSuccessRate,
    },
    activeGate: {
      eligible,
      reasons: gateReasons,
      minShadowSamples: ROUTING_MEMO_ACTIVE_GATE_MIN_SHADOW_SAMPLES,
      minDivergenceSuccessRate: ROUTING_MEMO_ACTIVE_GATE_MIN_DIVERGENCE_SUCCESS_RATE,
      shadowSampleCount,
      divergenceCount,
      divergenceSuccessRate,
    },
    recentSamples,
  };
}

/**
 * Build the shadow-phase diagnostic reason string for a recalled memo. Written
 * into `RouteDiagnostics.reasons` during shadow phase; the score itself is NOT
 * altered. Format: `memo-shadow:similar-task-success:reviewer:0.72` or
 * `memo-shadow:similar-task-poor:implementer:0.65`.
 */
export function buildMemoShadowReason(match: RoutingMemoMatch): string {
  const outcome = match.memo.outcome;
  const tag = outcome.qualityOverall === "poor_attempt"
    ? "similar-task-poor"
    : outcome.qualityOverall === "good" || outcome.graphStatus === "completed"
      ? "similar-task-success"
      : "similar-task-unclear";
  return `memo-shadow:${tag}:${match.memo.leadRole}:${match.similarity.toFixed(2)}`;
}

/**
 * Build the active-phase scoring adjustment from a recalled memo. Returns the
 * bounded score delta (+2 for good, −1 for poor) and the reason string, or
 * `undefined` when the memo outcome is unclear.
 */
export function buildMemoActiveAdjustment(
  match: RoutingMemoMatch,
): { delta: number; reason: string } | undefined {
  const outcome = match.memo.outcome;
  if (outcome.qualityOverall === "good" || outcome.graphStatus === "completed") {
    return { delta: 2, reason: `memo:similar-task-success:${match.memo.leadRole}` };
  }
  if (outcome.qualityOverall === "poor_attempt") {
    return { delta: -1, reason: `memo:similar-task-poor:${match.memo.leadRole}` };
  }
  return undefined;
}

export function resolveMemoFilePath(workspaceDir: string): string {
  return join(workspaceDir, ".clawx", "orchestration", ROUTING_MEMO_FILE_NAME);
}

function parseMemos(
  rawContent: string,
  log?: (message: string, context?: unknown) => void,
): RoutingMemo[] {
  const memos: RoutingMemo[] = [];
  const lines = rawContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const memo = normalizeMemo(parsed);
      if (memo) memos.push(memo);
    } catch (err) {
      log?.("[routing-memo] skipped corrupt line during parse", { err: String(err) });
    }
  }
  return memos;
}

function normalizeMemo(value: unknown): RoutingMemo | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) return undefined;
  const id = typeof record.id === "string" ? record.id : undefined;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined;
  const taskDigest = Array.isArray(record.taskDigest)
    ? record.taskDigest.filter((t): t is string => typeof t === "string")
    : undefined;
  const mode = record.mode === "router" || record.mode === "lead-workers" || record.mode === "adversarial-review"
    ? record.mode
    : undefined;
  const leadRole = typeof record.leadRole === "string" ? record.leadRole : undefined;
  const workerRoles = Array.isArray(record.workerRoles)
    ? record.workerRoles.filter((r): r is string => typeof r === "string")
    : undefined;
  if (!id || !createdAt || !taskDigest || !mode || !leadRole || !workerRoles) return undefined;
  const outcomeRecord = isRecord(record.outcome) ? record.outcome : undefined;
  if (!outcomeRecord) return undefined;
  const graphStatus = outcomeRecord.graphStatus === "pending"
    || outcomeRecord.graphStatus === "completed"
    || outcomeRecord.graphStatus === "partial"
    || outcomeRecord.graphStatus === "failed"
    ? outcomeRecord.graphStatus
    : undefined;
  if (!graphStatus) return undefined;
  const repairCount = typeof outcomeRecord.repairCount === "number"
    ? outcomeRecord.repairCount
    : 0;
  const qualityOverall = outcomeRecord.qualityOverall === "good"
    || outcomeRecord.qualityOverall === "needs_attention"
    || outcomeRecord.qualityOverall === "poor_attempt"
    ? outcomeRecord.qualityOverall
    : undefined;
  const shadowObservation = normalizeShadowObservation(record.shadowObservation);
  return {
    id,
    createdAt,
    workspaceDir: typeof record.workspaceDir === "string" ? record.workspaceDir : undefined,
    taskDigest,
    mode,
    leadRole,
    workerRoles,
    templateId: typeof record.templateId === "string" ? record.templateId : undefined,
    outcome: { graphStatus, qualityOverall, repairCount },
    ...(shadowObservation ? { shadowObservation } : {}),
  };
}

function readAllRoutingMemos(workspaceDir: string | undefined): RoutingMemo[] {
  if (!workspaceDir) return [];
  try {
    return parseMemos(readFileSync(resolveMemoFilePath(workspaceDir), "utf8"));
  } catch {
    return [];
  }
}

function normalizeShadowObservation(value: unknown): RoutingMemoShadowObservation | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record || record.mode !== "shadow") return undefined;
  const actualLeadRole = typeof record.actualLeadRole === "string" ? record.actualLeadRole : undefined;
  const memoLeadRole = typeof record.memoLeadRole === "string" ? record.memoLeadRole : undefined;
  const outcome = record.outcome === "same"
    || record.outcome === "memo_better"
    || record.outcome === "memo_worse"
    || record.outcome === "unknown"
    ? record.outcome
    : undefined;
  if (!actualLeadRole || !memoLeadRole || !outcome || typeof record.diverged !== "boolean") {
    return undefined;
  }
  return {
    mode: "shadow",
    actualLeadRole,
    memoLeadRole,
    diverged: record.diverged,
    outcome,
    ...(typeof record.similarity === "number" && Number.isFinite(record.similarity)
      ? { similarity: record.similarity }
      : {}),
  };
}

function zeroGraphStatusCounts(): Record<RoutingMemoGraphStatus, number> {
  return { pending: 0, completed: 0, partial: 0, failed: 0 };
}

function zeroQualityCounts(): Record<RoutingMemoQuality, number> {
  return { good: 0, needs_attention: 0, poor_attempt: 0 };
}

function zeroShadowOutcomeCounts(): Record<RoutingMemoShadowOutcome, number> {
  return { same: 0, memo_better: 0, memo_worse: 0, unknown: 0 };
}

function compactMemosFile(
  filePath: string,
  memos: RoutingMemo[],
  log?: (message: string, context?: unknown) => void,
): void {
  if (memos.length <= ROUTING_MEMO_MAX_ENTRIES) return;
  try {
    const sorted = [...memos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const kept = sorted.slice(0, ROUTING_MEMO_MAX_ENTRIES);
    const rewritten = kept.map((m) => JSON.stringify(m)).join("\n") + "\n";
    writeFileSync(filePath, rewritten, "utf8");
    log?.("[routing-memo] compacted store to cap", {
      before: memos.length,
      after: kept.length,
    });
  } catch (err) {
    log?.("[routing-memo] compaction failed (best-effort, swallowed)", { err: String(err) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of", "to",
  "in", "on", "at", "by", "with", "from", "up", "down", "is", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "can", "this",
  "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
  "what", "which", "who", "when", "where", "why", "how", "all", "each",
  "every", "some", "any", "no", "not", "as", "so", "than", "too", "very",
  // Common task-phrasing filler
  "please", "me", "my", "our", "your", "us", "them",
]);
