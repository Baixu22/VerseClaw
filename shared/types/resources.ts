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
  | "chat-history";

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
};

export type BackgroundWorkPriority = "foreground" | "background";
export type BackgroundWorkDeferReason = "shed-signal" | "queue-depth" | "tree-rss" | "tree-cpu";
export type BackgroundWorkGateInput = {
  shedSignal?: boolean;
  queueDepth?: number;
  treeRssBytes?: number;
  treeCpuPercent?: number;
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
