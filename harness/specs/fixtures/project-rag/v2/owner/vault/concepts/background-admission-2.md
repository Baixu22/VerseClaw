---
title: background-admission / shared/types/resources.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
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

Origin: shared/types/resources.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/**
 * Resource governance types shared by the Main-owned gateway runtime and the
 * renderer-facing host-api contract.
 *
 * These live under `shared/` because `shared/host-api/contract.ts` exposes the
 * resource envelope and background-work gate shapes, and `shared/**` must not
 * import from the app/runtime layer (see
 * `tests/unit/host-api-facade.test.ts` → `sharedToAppLayer`).
 *
 * The runtime keeps owning the behaviour; it imports and re-exports these
 * declarations from `openclaw_runtime/src/resources/*` so existing importers
 * are unaffected.
 */

export const RESOURCE_ENVELOPE_SCHEMA = "openclaw.resource-envelope/v1" as const;
export const RESOURCE_METRICS_TTL_MS = 30_000;

export type ResourceProcessObservation = {
  pid: number;
  parentPid: number;
  creationToken: string;
  rssBytes: number;
  /** Private committed bytes; unavailable on platforms without this counter. */
  privateBytes: number | null;
  cpuTimeMs: number;
  cpuPercent: number | null;
};

export type ResourceProcessMeasurement = {
  status: "ok" | "empty" | "unknown";
  sampledAt: number;
  ownerEpoch: string;
  rootPids: number[];
  processes: ResourceProcessObservation[];
};

export type ResourceProcessTotals = {
  processCount: number;
  rssBytes: number | null;
  privateBytes: number | null;
  cpuPercent: number | null;
};

export type ResourceEventLoopPressure = {
  sampledAt: number;
  ownerEpoch: string;
  degraded: boolean;
  delayP99Ms: number;
  delayMaxMs: number;
  utilization: number;
};

export type ResourceMachineCommit = { sampledAt: number; committedBytes: number; commitLimitBytes: number };

export type ResourceKind =
  | "agent-turn"
  | "terminal-exec"
  | "runtime-bash"
  | "workspace-search"
  | "workspace-writer"
  | "subtree-mutation"
  | "file-mutation"
  | "browser-session"
  | "pty-session"
  | "mcp-process"
  | "provider-sidecar"
  | "background-index"
  | "chat-history"
  | "network-pool";

export type ResourcePriority = "foreground" | "background";

export type ResourceLimitEvent = {
  at: number;
  from: number;
  to: number;
  reason: string;
};

/** Cooperative QoS class for the P1/P2 resource fabric. */
export type RequestPriority = "interactive" | "background" | "opportunistic";

export type ResourceLimits = {
  memoryBytes: number;
  cpuPercent: number;
  processCount: number;
  concurrencySlots: number;
  queueLength: number;
};

export type ResourceEnvelopeEntry = {
  id: string;
  workspaceKey: string;
  kind: ResourceKind;
  priority: ResourcePriority;
  owner: string;
  activeSlots: number;
  queuedCount: number;
  queueWaitMs: number;
  processCount: number;
  treeRssBytes: number;
  treeCpuPercent: number;
  pids?: number[];
  processMeasurement?: ResourceProcessMeasurement;
  limits: ResourceLimits;
  limitHistory?: ResourceLimitEvent[];
  updatedAt: number;
  reason?: string;
};

export type ResourceEnvelopeExceeded = {
  entryId: string;
  workspaceKey: string;
  kind: ResourceKind;
  priority: ResourcePriority;
  owner: string;
  dimension: keyof ResourceLimits;
  observed: number;
  limit: number;
  reason: string;
};

export type ResourceEnvelopeTotals = {
  activeSlots: number;
  queuedCount: number;
  queueWaitMs: number;
  processCount: number;
  treeRssBytes: number;
  treeCpuPercent: number;
};

export type ResourceEnvelopeSnapshot = {
  schema: typeof RESOURCE_ENVELOPE_SCHEMA;
  generatedAt: number;
  mode: "shadow";
  entries: ResourceEnvelopeEntry[];
  totals: ResourceEnvelopeTotals;
  exceeded: ResourceEnvelopeExceeded[];
  warnings: string[];
  producer?: { pid: number; epoch: string; creationToken?: string };
  processTotals?: ResourceProcessTotals;
  machineMemory?: { sampledAt: number; availablePhysicalBytes: number; totalPhysicalBytes: number };
  machineCommit?: ResourceMachineCommit;
  eventLoopPressure?: ResourceEventLoopPressure;
};

export type BackgroundWorkPriority = "foreground" | "background";
export type BackgroundWorkDeferReason = "shed-signal" | "queue-depth" | "tree-rss" | "tree-cpu" | "event-loop";
export type BackgroundWorkGateInput = {
  shedSignal?: boolean;
  queueDepth?: number;
  treeRssBytes?: number;
  treeCpuPercent?: number;
  eventLoopDegraded?: boolean;
};
export type BackgroundWorkGateState = {
  deferring: boolean;
  reason: BackgroundWorkDeferReason | null;
  activeReasons: BackgroundWorkDeferReason[];
  deferredCount: number;
  resumeCount: number;
  lastDeferReason: BackgroundWorkDeferReason | null;
  lastTransitionAt: number | null;
  transitionCount: number;
  pendingCount: number;
  foregroundChecks: number;
  foregroundDeferredCount: number;
};

~~~
