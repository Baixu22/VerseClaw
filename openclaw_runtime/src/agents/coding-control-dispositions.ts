/**
 * TF-0510: exclusive disposition of the coding control-plane components.
 *
 * Each entry records the current consumer, the disposition, the implementation
 * state, the implementing node, the verification artifact that can be recomputed
 * on disk, and the remaining gap. A node may only be closed when every
 * remainingGap is empty - classification, ownership, a follow-up node or an
 * expiry date are not substitutes for completion.
 *
 * This module deliberately makes no runtime decision: it is a read-only ledger
 * consumed by tests and by the TF-0510 acceptance generator.
 */

export const CODING_CONTROL_DISPOSITION_SCHEMA = "CodingControlDisposition/v1" as const;

export type CodingControlDisposition =
  | "internal"
  | "advanced"
  | "experiment"
  | "retired";

export type CodingControlImplementationState =
  | "implemented"
  | "implemented-opt-in"
  | "implemented-api-only"
  | "partial";

export type CodingControlComponent = {
  id: string;
  label: string;
  /** The runtime authority that currently consumes this component. */
  currentConsumer: string;
  disposition: CodingControlDisposition;
  implementationState: CodingControlImplementationState;
  /** Task Forest node that owns the implementation, or null when none is needed. */
  implementationNode: string | null;
  /** Repository-relative artifacts that can be re-hashed to recompute the claim. */
  verificationArtifact: string[];
  /** Empty only when the component is genuinely complete or retired. */
  remainingGap: string[];
  /** User- or model-reachable entry point, or null when there is none. */
  productEntry: string | null;
  notes: string;
};

export const CODING_CONTROL_COMPONENTS: readonly CodingControlComponent[] = [
  {
    id: "stale-write-guard",
    label: "Stale write guard",
    currentConsumer: "agent-tools write / apply_patch wrap",
    disposition: "advanced",
    implementationState: "implemented-opt-in",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/tools/stale-write-guard.test.ts",
      "openclaw_runtime/src/agents/stale-write-guard.ts",
    ],
    remainingGap: [],
    productEntry: "runtime.coding.staleWriteGuard.enabled (operator config)",
    notes:
      "Blocks only files this session has already read whose disk hash diverged; unread files and the edit tool are untouched. Six cases cover block, allow, unread, flag-off, explainable error and the recorded force/allowStaleWrite override. Default stays false: flipping it changes write behaviour for every user and is a product decision, not an implementation gap.",
  },
  {
    id: "symbol-lease",
    label: "Symbol lease / WAL",
    currentConsumer: "edit / write / apply_patch concurrency guard",
    disposition: "experiment",
    implementationState: "implemented-opt-in",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/symbol-lease-guard.test.ts",
      "openclaw_runtime/src/agents/symbol-lease-guard.ts",
      "openclaw_runtime/src/context-engine/factstore/symbol-lease.ts",
      "openclaw_runtime/src/context-engine/factstore/symbol-lease.test.ts",
    ],
    remainingGap: [
      "Graduation is undefined by evidence: its own graduateOrRetireCriteria requires multi-writer benchmarks showing lower conflict/rework with reliable rollback, and no such benchmark exists in the repo. Single-process and multi-process correctness are proven; the benefit claim is not.",
      "The owning record cannot be updated from here: feature.symbol-lease is experiment with a 2026-12-31 expiry in shared/dcs/component-disposition-catalog.ts, and shared/ is outside the TF-0510 write scope.",
    ],
    productEntry: "runtime.coding.symbolLease.enabled + .mode (operator config)",
    notes:
      "Fail-closed on conflict and released on success or error; apply_patch targets resolve to file-level symbols. MULTI_PROCESS_WAL_HARDENED is true and factstore/symbol-lease.test.ts covers expired reclaim, WAL rehydration blocking a second logical process, release-then-reacquire, a concurrent-acquire single winner under lock and compaction. Memory remains the default mode; choosing WAL as the default is a product decision, not an implementation gap.",
  },
  {
    id: "patch-flow",
    label: "Patch flow (serial fenced apply)",
    currentConsumer: "team_orchestrate patchFlowExecution + orchestrator serial apply",
    disposition: "experiment",
    implementationState: "implemented-opt-in",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/orchestration-patch-flow.test.ts",
      "openclaw_runtime/src/agents/patch-flow.ts",
      "openclaw_runtime/src/agents/patch-flow-graduation.ts",
    ],
    remainingGap: [
      "Graduation is undefined by evidence: its own graduateOrRetireCriteria requires patch execution to improve verified coding outcomes while preserving write-journal authority, and no outcome comparison exists in the repo.",
      "The only product entries are the model tool parameter patchFlowExecution=true and an operator config flag; no natural task action or explicit concurrent workflow selects it, so it remains an opt-in path.",
      "The owning record cannot be updated from here: feature.patch-flow is experiment with a 2026-12-31 expiry in shared/dcs/component-disposition-catalog.ts, and shared/ is outside the TF-0510 write scope.",
    ],
    productEntry: "team_orchestrate patchFlowExecution=true (model tool parameter)",
    notes:
      "Serial fenced apply, destructive holds, a 10-cycle agent-driven soak and fail-closed missing-workspace behaviour are all tested. What is missing is a product decision plus a non-vacuous graduation gate, not more code.",
  },
  {
    id: "worktree-backend",
    label: "Worktree backend",
    currentConsumer: "orchestrator isolation=worktree -> createWorktreeService",
    disposition: "advanced",
    implementationState: "implemented-opt-in",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/worktree-service.test.ts",
      "openclaw_runtime/src/agents/worktree-service.ts",
    ],
    remainingGap: [],
    productEntry: "isolation=worktree on an orchestrator request/plan",
    notes:
      "In-process is the default backend; the git backend is opt-in and falls back to inprocess outside a git repo. Windows separators, traversal rejection, concurrent create/merge/cleanup and a two-worker overlap conflict are covered. TFD-tf0137-api-only-promise-withdrawal-20260830 already resolved the config-flag promise: the backend is selected through the real API argument, and the config leaf is ack-only.",
  },
  {
    id: "isolation-request",
    label: "Isolation request",
    currentConsumer: "orchestrator normalizeIsolationMode",
    disposition: "advanced",
    implementationState: "implemented-opt-in",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/isolation-mode-matrix.test.ts",
      "openclaw_runtime/src/agents/isolation-mode-matrix.ts",
      "openclaw_runtime/src/agents/worktree-service.test.ts",
    ],
    remainingGap: [],
    productEntry: "isolation: \"worktree\" | \"shared\" on a request/plan",
    notes:
      "Defaults to shared; unknown values normalize to shared; worktree is accepted by the orchestrator plan and carried through HandoffPack alongside writeSet/worktreeId. Shared is intentionally the product default until multi-writer isolation is approved.",
  },
];

/** Components that still block a truthful TF-0510 closeout. */
export function codingControlGaps(): Array<{ id: string; remainingGap: readonly string[] }> {
  return CODING_CONTROL_COMPONENTS
    .filter((component) => component.remainingGap.length > 0)
    .map((component) => ({ id: component.id, remainingGap: component.remainingGap }));
}

/** True only when every component reports an empty remaining gap. */
export function codingControlComplete(): boolean {
  return codingControlGaps().length === 0;
}