/**
 * Shadow-only async soft-threshold compaction planner.
 *
 * This module does not alter runtime compaction behavior. It evaluates whether a
 * foreground budget compaction would be safe to defer, captures a logical
 * transcript CAS, and provides a bounded runner seam for a future promotion spec.
 */
import { createHash } from "node:crypto";
import { readTranscriptFileState } from "../../agents/embedded-agent-runner/transcript-file-state.js";

export const DEFAULT_SOFT_THRESHOLD_MIN_HEADROOM_TOKENS = 12_000;

export type SoftThresholdTrigger = "budget" | "overflow" | "manual";
export type SoftThresholdAction = "disabled" | "sync" | "would-defer";

export type SoftThresholdShadowOptions = {
  enabled?: boolean;
  minHeadroomTokens?: number;
};

export type SoftThresholdShadowPlan = {
  action: SoftThresholdAction;
  reason: string;
  minHeadroomTokens: number;
  headroomTokens?: number;
  tokenBudget?: number;
  currentTokenCount?: number;
};

export type SoftThresholdCas = {
  branchHeadId: string | null;
  digest: string;
  entryCount: number;
};

function normalizeHeadroom(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value >= 0
    ? value
    : DEFAULT_SOFT_THRESHOLD_MIN_HEADROOM_TOKENS;
}

/** Return a shadow decision without scheduling or executing compaction. */
export function planSoftThresholdShadow(input: {
  trigger: SoftThresholdTrigger;
  currentTokenCount?: number;
  tokenBudget?: number;
  options?: SoftThresholdShadowOptions;
}): SoftThresholdShadowPlan {
  const minHeadroomTokens = normalizeHeadroom(input.options?.minHeadroomTokens);
  if (input.options?.enabled !== true) {
    return { action: "disabled", reason: "shadow_disabled", minHeadroomTokens };
  }
  if (input.trigger !== "budget") {
    return { action: "sync", reason: `${input.trigger}_stays_sync`, minHeadroomTokens };
  }
  const tokenBudget = input.tokenBudget;
  const currentTokenCount = input.currentTokenCount;
  if (
    typeof tokenBudget !== "number" ||
    !Number.isFinite(tokenBudget) ||
    tokenBudget <= 0 ||
    typeof currentTokenCount !== "number" ||
    !Number.isFinite(currentTokenCount) ||
    currentTokenCount < 0
  ) {
    return { action: "sync", reason: "unknown_pressure", minHeadroomTokens };
  }
  const headroomTokens = tokenBudget - currentTokenCount;
  if (headroomTokens < minHeadroomTokens) {
    return {
      action: "sync",
      reason: "insufficient_headroom",
      minHeadroomTokens,
      headroomTokens,
      tokenBudget,
      currentTokenCount,
    };
  }
  return {
    action: "would-defer",
    reason: "soft_threshold_headroom",
    minHeadroomTokens,
    headroomTokens,
    tokenBudget,
    currentTokenCount,
  };
}

/** Capture a logical transcript head + digest for CAS before deferral. */
export async function captureSoftThresholdCas(params: {
  sessionFile: string;
}): Promise<SoftThresholdCas> {
  const state = await readTranscriptFileState(params.sessionFile);
  const entries = state.getEntries();
  const digest = createHash("sha256")
    .update(JSON.stringify({ header: state.header, entries }), "utf8")
    .digest("hex");
  return { branchHeadId: state.getLeafId(), digest, entryCount: entries.length };
}

export function softThresholdCasMatches(
  expected: SoftThresholdCas,
  current: SoftThresholdCas,
): boolean {
  return expected.branchHeadId === current.branchHeadId && expected.digest === current.digest;
}

export type SoftThresholdShadowRunResult = {
  status: "not-deferred" | "cas-mismatch" | "completed" | "fallback-sync";
  fallbackApplied: boolean;
  error?: unknown;
};

/**
 * Execute a callback only when the shadow plan would defer and the CAS still
 * matches. Failure is contained and the synchronous fallback is invoked once.
 */
export async function runSoftThresholdShadow(params: {
  plan: SoftThresholdShadowPlan;
  expectedCas: SoftThresholdCas;
  sessionFile: string;
  runDeferred: () => Promise<void>;
  fallbackSync: () => Promise<void>;
}): Promise<SoftThresholdShadowRunResult> {
  if (params.plan.action !== "would-defer") {
    return { status: "not-deferred", fallbackApplied: false };
  }
  const currentCas = await captureSoftThresholdCas({ sessionFile: params.sessionFile });
  if (!softThresholdCasMatches(params.expectedCas, currentCas)) {
    return { status: "cas-mismatch", fallbackApplied: false };
  }
  try {
    await params.runDeferred();
    return { status: "completed", fallbackApplied: false };
  } catch (error) {
    await params.fallbackSync();
    return { status: "fallback-sync", fallbackApplied: true, error };
  }
}
