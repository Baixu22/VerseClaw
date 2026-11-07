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

export type CodingControlDisposition = "internal" | "advanced" | "experiment" | "retired";

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
      "openclaw_runtime/src/agents/stale-write-guard.false-block.test.ts",
      "openclaw_runtime/src/agents/stale-write-guard.ts",
    ],
    remainingGap: [],
    productEntry: "runtime.coding.staleWriteGuard.enabled (operator config)",
    notes:
      "Blocks only files this session has already read whose disk hash diverged; unread files and the edit tool are untouched. Six cases cover block, allow, unread, flag-off, explainable error and the recorded force/allowStaleWrite override. The labelled false-block corpus (stale-write-guard.false-block.test.ts) measures 1/5 genuine stale blocks and 4/5 must-allow writes, with a measured false-block rate of 0. Default stays false: flipping it changes write behaviour for every user and is a product decision, not an implementation gap.",
  },
  {
    id: "symbol-lease",
    label: "Symbol lease / WAL",
    currentConsumer: "retained benchmark sources; execution retired",
    disposition: "retired",
    implementationState: "implemented",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/symbol-lease-guard.test.ts",
      "openclaw_runtime/src/agents/symbol-lease-guard.ts",
      "openclaw_runtime/src/context-engine/factstore/symbol-lease.ts",
      "openclaw_runtime/src/context-engine/factstore/symbol-lease.test.ts",
      "tests/unit/coding-controls-tf0510-symbol-lease-benchmark.test.ts",
    ],
    remainingGap: [],
    productEntry: null,
    notes:
      "Retired by TF-0510. Correctness was proven (MULTI_PROCESS_WAL_HARDENED; expired reclaim, WAL rehydration blocking a second logical process, release-then-reacquire, concurrent-acquire single winner, compaction) and a 4-process benchmark measured 12 wins / 36 denials with zero duplicate side effects. That 75% denial rate is throughput cost without added safety over isolated worktrees, so the capability is retired: isCodingSymbolLeaseEnabled now always returns false and the writable switch was removed. Code is retained; rollback is a revert.",
  },
  {
    id: "patch-flow",
    label: "Patch flow (serial fenced apply)",
    currentConsumer: "historical apply records; execution retired",
    disposition: "retired",
    implementationState: "implemented",
    implementationNode: "TF-0510",
    verificationArtifact: [
      "openclaw_runtime/src/agents/orchestration-patch-flow.test.ts",
      "openclaw_runtime/src/agents/patch-flow.ts",
      "openclaw_runtime/src/agents/patch-flow-graduation.ts",
      "tests/unit/coding-controls-tf0510-patchflow-trigger.test.ts",
    ],
    remainingGap: [],
    productEntry: null,
    notes:
      "Retired by TF-0510. Request/config admission leaves ordinary worker tools intact; restored execution markers cannot start new candidate application. Historical applied effects retain their recorded status and identity. Concurrent coding uses explicit worktree isolation and the existing journal/candidate owner.",
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
      "Inprocess remains the default backend. Explicit worktree requests select the configured inprocess/Git backend; an unavailable Git checkout is rejected before spawn. Owner-verified Git checkouts provide checkout isolation, while inprocess records identify directory simulation. Journal-backed merge rejects stale or conflicting candidates.",
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
    productEntry: 'isolation: "worktree" | "shared" on a request/plan',
    notes:
      "Defaults to shared; explicit unknown isolation values are rejected. Worktree requests inherit to workers unless explicitly overridden, and execute under the parent session's authorized workspace and generation. Only owner-verified Git checkouts prove checkout isolation; directory simulation remains inprocess. Shared remains the product default.",
  },
];

/** Components that still block a truthful TF-0510 closeout. */
export function codingControlGaps(): Array<{ id: string; remainingGap: readonly string[] }> {
  return CODING_CONTROL_COMPONENTS.filter((component) => component.remainingGap.length > 0).map(
    (component) => ({ id: component.id, remainingGap: component.remainingGap }),
  );
}

/** True only when every component reports an empty remaining gap. */
export function codingControlComplete(): boolean {
  return codingControlGaps().length === 0;
}
