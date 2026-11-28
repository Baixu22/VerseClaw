---
title: shared/host-api/host-deadline.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T05:05:56.255Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: shared/host-api/host-deadline.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/**
 * NET-E (TF-0442): one logical deadline for a host action.
 *
 * A host action crosses several layers (renderer -> Main -> gateway -> provider).
 * Each layer used to apply its own full timeout, so a hung end-to-end request
 * could take the sum of every layer's budget. Instead the outermost layer
 * creates ONE deadline (an absolute epoch timestamp plus the total budget) and
 * every layer clamps its own timeout to what remains:
 *
 *   effective = min(local budget, deadlineAtMs - now)
 *
 * The deadline travels as plain metadata on the host request. It is not a
 * product default change: the local budgets still come from the existing shared
 * timeout table (`host-action-timeouts.ts`), including the long-action allowlist.
 */
export type HostDeadlineStage = 'renderer' | 'main' | 'gateway' | 'provider';

export type HostDeadline = {
  /** Absolute epoch ms when the logical request must be aborted. */
  deadlineAtMs: number;
  /** Total budget the outermost layer granted, in ms. */
  timeoutMs: number;
  /** Layer that created the deadline. */
  stage: HostDeadlineStage;
  /** Local correlation id (never a provider request id). */
  requestId?: string;
};

export type HostTimeoutDetails = {
  /** Layer that produced the timeout. */
  stage: HostDeadlineStage;
  /** Budget this stage actually enforced, in ms (already clamped). */
  deadlineMs: number;
  /** How long the stage ran before it timed out, in ms. */
  elapsedMs: number;
  /** Local correlation id; the provider request id stays a separate field. */
  requestId?: string;
  /** Absolute logical deadline when one was propagated. */
  deadlineAtMs?: number;
};

const STAGES: readonly HostDeadlineStage[] = ['renderer', 'main', 'gateway', 'provider'];

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/** Creates the logical deadline for one host action. */
export function createHostDeadline(params: {
  stage: HostDeadlineStage;
  timeoutMs: number;
  requestId?: string;
  now?: () => number;
}): HostDeadline {
  const now = params.now ?? Date.now;
  const timeoutMs = readPositiveInt(params.timeoutMs) ?? 0;
  return {
    deadlineAtMs: now() + timeoutMs,
    timeoutMs,
    stage: params.stage,
    ...(params.requestId ? { requestId: params.requestId } : {}),
  };
}

/** Milliseconds left in the logical budget; never negative. */
export function remainingHostBudgetMs(
  deadline: HostDeadline,
  now: () => number = Date.now,
): number {
  return Math.max(0, deadline.deadlineAtMs - now());
}

export function isHostDeadlineExpired(
  deadline: HostDeadline,
  now: () => number = Date.now,
): boolean {
  return remainingHostBudgetMs(deadline, now) <= 0;
}

/**
 * Clamps a layer-local timeout to the remaining logical budget. Layers must use
 * the result as their timeout; they never add their budget to the deadline.
 */
export function clampHostTimeoutToDeadline(
  localTimeoutMs: number,
  deadline: HostDeadline | undefined,
  now: () => number = Date.now,
): number {
  const local = readPositiveInt(localTimeoutMs) ?? 0;
  if (!deadline) {
    return local;
  }
  const remaining = remainingHostBudgetMs(deadline, now);
  return Math.max(0, Math.min(local, remaining));
}

/** Validates deadline metadata arriving from another layer. */
export function readHostDeadline(value: unknown): HostDeadline | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const deadlineAtMs = readPositiveInt(record.deadlineAtMs);
  const timeoutMs = readPositiveInt(record.timeoutMs);
  const stage = typeof record.stage === 'string' && STAGES.includes(record.stage as HostDeadlineStage)
    ? (record.stage as HostDeadlineStage)
    : undefined;
  if (deadlineAtMs === undefined || timeoutMs === undefined || stage === undefined) {
    return undefined;
  }
  const requestId = typeof record.requestId === 'string' && record.requestId.trim()
    ? record.requestId
    : undefined;
  return {
    deadlineAtMs,
    timeoutMs,
    stage,
    ...(requestId ? { requestId } : {}),
  };
}

/** Structured timeout details shared by every layer. */
export function toHostTimeoutDetails(params: {
  stage: HostDeadlineStage;
  deadlineMs: number;
  elapsedMs: number;
  requestId?: string;
  deadline?: HostDeadline;
}): HostTimeoutDetails {
  const requestId = params.requestId ?? params.deadline?.requestId;
  return {
    stage: params.stage,
    deadlineMs: Math.max(0, Math.floor(params.deadlineMs)),
    elapsedMs: Math.max(0, Math.floor(params.elapsedMs)),
    ...(requestId ? { requestId } : {}),
    ...(params.deadline ? { deadlineAtMs: params.deadline.deadlineAtMs } : {}),
  };
}

~~~
