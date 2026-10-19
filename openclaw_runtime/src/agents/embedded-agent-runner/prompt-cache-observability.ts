/**
 * Tracks prompt-cache snapshot changes for observability diagnostics.
 */
import crypto from "node:crypto";
import type { NormalizedUsage } from "../usage.js";
import { parseBooleanValue } from "../../utils/boolean.js";

export type PromptCacheChangeCode =
  | "cacheRetention"
  | "model"
  | "streamStrategy"
  | "systemPrompt"
  | "tools"
  | "transport";

export type PromptCacheChange = {
  code: PromptCacheChangeCode;
  detail: string;
};

export type PromptCacheSnapshot = {
  provider: string;
  modelId: string;
  modelApi?: string | null;
  cacheRetention?: "none" | "short" | "long";
  streamStrategy: string;
  transport?: string;
  systemPromptDigest: string;
  toolDigest: string;
  toolCount: number;
  toolNames: string[];
};

export type PromptCacheObservationStart = {
  snapshot: PromptCacheSnapshot;
  changes: PromptCacheChange[] | null;
  previousCacheRead: number | null;
};

export type PromptCacheBreak = {
  previousCacheRead: number;
  cacheRead: number;
  changes: PromptCacheChange[] | null;
};

type PromptCacheTracker = {
  snapshot: PromptCacheSnapshot;
  lastCacheRead: number | null;
  pendingChanges: PromptCacheChange[] | null;
};

const trackers = new Map<string, PromptCacheTracker>();
const MAX_TRACKERS = 512;

const MIN_CACHE_BREAK_TOKEN_DROP = 1_000;
const MAX_STABLE_CACHE_READ_RATIO = 0.95;

function digestText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildTrackerKey(params: {
  promptCacheKey?: string;
  sessionKey?: string;
  sessionId: string;
}): string {
  const promptCacheKey = params.promptCacheKey?.trim();
  if (promptCacheKey) {
    return promptCacheKey;
  }
  return params.sessionKey?.trim() || params.sessionId;
}

function buildToolDigest(toolNames: string[]): string {
  // Treat diagnostics as set-stable here: order changes alone should not look
  // like a real cache break when the same tool set is still present.
  return digestText(JSON.stringify([...toolNames].toSorted()));
}

function setTracker(key: string, tracker: PromptCacheTracker): void {
  if (trackers.has(key)) {
    trackers.delete(key);
  } else if (trackers.size >= MAX_TRACKERS) {
    const oldestKey = trackers.keys().next().value;
    if (typeof oldestKey === "string") {
      trackers.delete(oldestKey);
    }
  }
  trackers.set(key, tracker);
}

function diffSnapshots(
  previous: PromptCacheSnapshot,
  next: PromptCacheSnapshot,
): PromptCacheChange[] | null {
  const changes: PromptCacheChange[] = [];
  if (previous.provider !== next.provider || previous.modelId !== next.modelId) {
    changes.push({
      code: "model",
      detail: `${previous.provider}/${previous.modelId} -> ${next.provider}/${next.modelId}`,
    });
  } else if ((previous.modelApi ?? null) !== (next.modelApi ?? null)) {
    changes.push({
      code: "model",
      detail: `${previous.modelApi ?? "unknown"} -> ${next.modelApi ?? "unknown"}`,
    });
  }
  if (previous.cacheRetention !== next.cacheRetention) {
    changes.push({
      code: "cacheRetention",
      detail: `${previous.cacheRetention ?? "default"} -> ${next.cacheRetention ?? "default"}`,
    });
  }
  if (previous.transport !== next.transport) {
    changes.push({
      code: "transport",
      detail: `${previous.transport ?? "default"} -> ${next.transport ?? "default"}`,
    });
  }
  if (previous.streamStrategy !== next.streamStrategy) {
    changes.push({
      code: "streamStrategy",
      detail: `${previous.streamStrategy} -> ${next.streamStrategy}`,
    });
  }
  if (previous.systemPromptDigest !== next.systemPromptDigest) {
    changes.push({
      code: "systemPrompt",
      detail: "system prompt digest changed",
    });
  }
  if (previous.toolDigest !== next.toolDigest) {
    changes.push({
      code: "tools",
      detail:
        previous.toolCount === next.toolCount
          ? "tool set changed with same count"
          : `${previous.toolCount} -> ${next.toolCount} tools`,
    });
  }
  return changes.length > 0 ? changes : null;
}

export function collectPromptCacheToolNames(tools: readonly { name?: string }[]): string[] {
  const names: string[] = [];
  for (const tool of tools) {
    try {
      const name = tool.name?.trim();
      if (name) {
        names.push(name);
      }
    } catch {
      continue;
    }
  }
  return names;
}

export function beginPromptCacheObservation(params: {
  sessionId: string;
  promptCacheKey?: string;
  sessionKey?: string;
  provider: string;
  modelId: string;
  modelApi?: string | null;
  cacheRetention?: "none" | "short" | "long";
  streamStrategy: string;
  transport?: string;
  systemPrompt: string;
  toolNames: string[];
}): PromptCacheObservationStart {
  const key = buildTrackerKey(params);
  const snapshot: PromptCacheSnapshot = {
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.modelApi,
    cacheRetention: params.cacheRetention,
    streamStrategy: params.streamStrategy,
    transport: params.transport,
    systemPromptDigest: digestText(params.systemPrompt),
    toolDigest: buildToolDigest(params.toolNames),
    toolCount: params.toolNames.length,
    toolNames: [...params.toolNames],
  };
  const previous = trackers.get(key);
  const changes = previous ? diffSnapshots(previous.snapshot, snapshot) : null;
  setTracker(key, {
    snapshot,
    lastCacheRead: previous?.lastCacheRead ?? null,
    pendingChanges: changes,
  });
  return {
    snapshot,
    changes,
    previousCacheRead: previous?.lastCacheRead ?? null,
  };
}

export function completePromptCacheObservation(params: {
  sessionId: string;
  promptCacheKey?: string;
  sessionKey?: string;
  usage?: NormalizedUsage;
}): PromptCacheBreak | null {
  const key = buildTrackerKey(params);
  const tracker = trackers.get(key);
  if (!tracker) {
    return null;
  }

  const cacheRead = params.usage?.cacheRead;
  if (typeof cacheRead !== "number" || !Number.isFinite(cacheRead)) {
    tracker.pendingChanges = null;
    return null;
  }
  const previousCacheRead = tracker.lastCacheRead;
  tracker.lastCacheRead = cacheRead;

  if (previousCacheRead == null || previousCacheRead <= 0) {
    tracker.pendingChanges = null;
    return null;
  }

  const tokenDrop = previousCacheRead - cacheRead;
  const hasMeaningfulDrop =
    cacheRead < previousCacheRead * MAX_STABLE_CACHE_READ_RATIO &&
    tokenDrop >= MIN_CACHE_BREAK_TOKEN_DROP;
  const result = hasMeaningfulDrop
    ? {
        previousCacheRead,
        cacheRead,
        changes: tracker.pendingChanges,
      }
    : null;
  tracker.pendingChanges = null;
  return result;
}

/**
 * Bounded, dependency-free prompt-cache hit-rate metric.
 *
 * Attribution above answers "which input broke a warm prefix". This answers a
 * different question: over a bounded window, how much of the prompt budget was
 * actually served from cache. Manus' context-engineering write-up argues this
 * is the single most important production metric for an agent (cached input
 * tokens cost ~10x less than uncached), but a break counter alone cannot show
 * it, because a run can have zero breaks and still be serving almost nothing
 * from cache.
 *
 * Deliberate boundaries:
 * - Pure in-memory accounting, no I/O, no persistence, no new dependency.
 * - Never a routing authority on its own: callers decide what to do with it.
 * - Bounded per tracker key and globally, so it cannot grow without limit.
 */

export type PromptCacheHitRateSample = {
  /** Cache-served input tokens observed across the window. */
  cacheReadTokens: number;
  /** Total input-prompt tokens observed across the window (cache-served included). */
  totalPromptTokens: number;
  /** Turn observations that carried usable usage. */
  observations: number;
  /** cacheReadTokens / totalPromptTokens, or null before any denominator exists. */
  hitRate: number | null;
};

export type PromptCacheHitRateWindow = PromptCacheHitRateSample & {
  provider: string;
  modelId: string;
  /** Attributed warm-prefix breaks seen inside this window. */
  breaks: number;
  /** Wall-clock ms when the window was last advanced. */
  updatedAt: number;
};

type PromptCacheHitRateAccumulator = {
  cacheReadTokens: number;
  totalPromptTokens: number;
  observations: number;
  breaks: number;
  updatedAt: number;
};

const hitRateWindows = new Map<string, PromptCacheHitRateAccumulator>();

/** Per-key and global caps keep the metric bounded in long-lived runtimes. */
const MAX_HIT_RATE_WINDOWS = 512;
const MAX_HIT_RATE_WINDOW_TOKENS = 1_000_000_000;

function setHitRateWindow(key: string, value: PromptCacheHitRateAccumulator): void {
  hitRateWindows.delete(key);
  while (hitRateWindows.size >= MAX_HIT_RATE_WINDOWS) {
    const oldestKey = hitRateWindows.keys().next().value;
    if (typeof oldestKey !== "string") break;
    hitRateWindows.delete(oldestKey);
  }
  hitRateWindows.set(key, value);
}

function clampWindowTokens(value: number): number {
  return Math.min(Math.max(value, 0), MAX_HIT_RATE_WINDOW_TOKENS);
}

/**
 * Record one turn's cache usage into the bounded hit-rate window for this key.
 * Returns the updated window, or null when the provider reported no usable
 * cacheRead value (in which case nothing is counted rather than guessing).
 */
export function recordPromptCacheHitRateSample(params: {
  promptCacheKey?: string;
  sessionKey?: string;
  sessionId: string;
  usage?: NormalizedUsage;
  broke?: boolean;
  now?: number;
}): PromptCacheHitRateWindow | null {
  const cacheRead = params.usage?.cacheRead;
  const input = params.usage?.input;
  if (typeof cacheRead !== "number" || !Number.isFinite(cacheRead) || cacheRead < 0) {
    return null;
  }
  const promptTokens = typeof input === "number" && Number.isFinite(input) && input > 0
    ? input + cacheRead
    : cacheRead;
  if (promptTokens <= 0) return null;

  const key = buildTrackerKey(params);
  const previous = hitRateWindows.get(key);
  const next: PromptCacheHitRateAccumulator = {
    cacheReadTokens: clampWindowTokens((previous?.cacheReadTokens ?? 0) + cacheRead),
    totalPromptTokens: clampWindowTokens((previous?.totalPromptTokens ?? 0) + promptTokens),
    observations: (previous?.observations ?? 0) + 1,
    breaks: (previous?.breaks ?? 0) + (params.broke ? 1 : 0),
    updatedAt: params.now ?? Date.now(),
  };
  setHitRateWindow(key, next);

  const tracker = trackers.get(key);
  return {
    ...toHitRateSample(next),
    provider: tracker?.snapshot.provider ?? "unknown",
    modelId: tracker?.snapshot.modelId ?? "unknown",
    breaks: next.breaks,
    updatedAt: next.updatedAt,
  };
}

function toHitRateSample(value: PromptCacheHitRateAccumulator): PromptCacheHitRateSample {
  return {
    cacheReadTokens: value.cacheReadTokens,
    totalPromptTokens: value.totalPromptTokens,
    observations: value.observations,
    hitRate: value.totalPromptTokens > 0 ? value.cacheReadTokens / value.totalPromptTokens : null,
  };
}

/** Read the current bounded window without mutating it. */
export function readPromptCacheHitRate(params: {
  promptCacheKey?: string;
  sessionKey?: string;
  sessionId: string;
}): PromptCacheHitRateWindow | null {
  const key = buildTrackerKey(params);
  const window = hitRateWindows.get(key);
  if (!window) return null;
  const tracker = trackers.get(key);
  return {
    ...toHitRateSample(window),
    provider: tracker?.snapshot.provider ?? "unknown",
    modelId: tracker?.snapshot.modelId ?? "unknown",
    breaks: window.breaks,
    updatedAt: window.updatedAt,
  };
}

/** Aggregate every tracked window. Used by benchmarks and diagnostics. */
export function readAggregatedPromptCacheHitRate(): {
  cacheReadTokens: number;
  totalPromptTokens: number;
  observations: number;
  breaks: number;
  hitRate: number | null;
} {
  let cacheReadTokens = 0;
  let totalPromptTokens = 0;
  let observations = 0;
  let breaks = 0;
  for (const window of hitRateWindows.values()) {
    cacheReadTokens += window.cacheReadTokens;
    totalPromptTokens += window.totalPromptTokens;
    observations += window.observations;
    breaks += window.breaks;
  }
  return {
    cacheReadTokens,
    totalPromptTokens,
    observations,
    breaks,
    hitRate: totalPromptTokens > 0 ? cacheReadTokens / totalPromptTokens : null,
  };
}

/** Reset the hit-rate windows alongside the attribution trackers. */
export function resetPromptCacheHitRateForTest(): void {
  hitRateWindows.clear();
}

export function resetPromptCacheObservabilityForTest(): void {
  trackers.clear();
  resetPromptCacheHitRateForTest();
}

/**
 * Environment kill switch for prompt-cache break attribution.
 *
 * Attribution is pure in-memory bookkeeping with no I/O, so it is on by
 * default: without it the runtime cannot say *which* input broke a warm
 * prefix, and cache hit-rate can never become a scheduling input. Operators
 * can turn it off with `OPENCLAW_PROMPT_CACHE_OBSERVABILITY=0`.
 */
export const PROMPT_CACHE_OBSERVABILITY_ENV = "OPENCLAW_PROMPT_CACHE_OBSERVABILITY";

/** Resolves whether prompt-cache break attribution runs. Defaults on. */
export function isPromptCacheObservabilityEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanValue(env[PROMPT_CACHE_OBSERVABILITY_ENV]) ?? true;
}
