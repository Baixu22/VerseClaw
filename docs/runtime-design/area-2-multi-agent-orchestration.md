# 2. Multi-Agent Orchestration

## Exploration Log

> FAILURE NOTE: The mandatory `codegraph_decide` and `codegraph_context_plan` calls could not be executed because CodeGraph tools/resources are not exposed in this session. I used the plan's named files, local searches, and focused source reads instead.

- CodeGraph plans executed: unavailable. Local fallback reading list covered orchestrator planning, role routing, observed execution, protocol types, ClawGraph types, role contracts, role spawning, subagent metadata, and design overview sections 8.5.2/11.
- Files read:
  - `openclaw_runtime/src/agents/orchestrator.ts`: `createOrchestratorPlan` already supports explicit workers, templates, maxWorkers, task graphs, execution waves, verifier roles, and route diagnostics.
  - `openclaw_runtime/src/agents/role-router.ts`: role selection is keyword/capability driven with modes `router`, `lead-workers`, and `adversarial-review`.
  - `openclaw_runtime/src/agents/orchestrator-run-observed.ts`: observed orchestration records spans and already launches each execution wave with `Promise.allSettled`; verifier is deferred and completion-aware.
  - `openclaw_runtime/src/agents/orchestration-protocol.ts`: owns graph nodes, dependency edges, execution waves, quality/repair policies, worker communication enum, worker quality scores, repair nodes, and reroute recommendations.
  - `shared/types/clawgraph.ts`: ClawGraph already models workflow DAGs, `control.maxParallel`, structured handoffs, node snapshots, events, audit, review, and run status.
  - `openclaw_runtime/src/observability/role-first-observer.ts`: wraps role routing/orchestrator planning/context/memory operations in trace spans and builds scorecards on completion.
  - `openclaw_runtime/src/agents/role-contract.ts`: roles are the identity/permission primitive; role contracts include tools, capabilities, filesystem/network permissions, effort, output schema, and handoff rules.
  - `openclaw_runtime/src/agents/role-spawn.ts`: role workers spawn through existing subagent runtime with hard tool allowlists and permission-derived deny lists.
  - `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`: public tool accepts `bounded_a2a` but normalizes it to `none`, reports `boundedA2aEnabled: false`, and returns the Team Result Bundle fields.
  - `openclaw_runtime/src/agents/subagent-registry.types.ts`: `TeamOrchestrationMetadata` persists orchestration run id, task graph, execution waves, route diagnostics, quality/repair policies, and worker communication.
  - `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts`: file mutations are serialized per real file while allowing independent file operations to run in parallel.
  - `docs/clawx-design-overview.md`: documents role-first orchestration, parallel lead+workers, ClawGraph stateless DAG execution, handoff contract, user review gates, and the non-goal that ClawGraph is not a drag-and-drop editor or replacement for role contracts/Task Ledger/observability.
- Existing modules found:
  - Production: `role-contract.ts`, `role-registry.ts`, `role-router.ts`, `orchestrator.ts`, `orchestration-protocol.ts`, `orchestrator-run-observed.ts`, `role-spawn.ts`, `subagent-spawn.ts`, `subagent-registry.types.ts`, `file-mutation-queue.ts`.
  - Production: ClawGraph shared contract in `shared/types/clawgraph.ts` and runtime docs describing compile/run/status/events/review.
  - Production: observability trace wrapper in `openclaw_runtime/src/observability/role-first-observer.ts`.
  - Planned/disabled: `WorkerCommunicationPolicy = "bounded_a2a"` exists, but `team-orchestrate-tool.ts` disables it by normalizing to `none`.
- Non-goals and constraints identified:
  - Do not replace role contracts; roles are worker identity.
  - Do not replace ClawGraph; extend its DAG and handoff semantics.
  - ClawGraph is not a drag-and-drop editor, container orchestrator, Task Ledger replacement, or observability replacement.
  - Lead agents should use push-based completion instead of polling child sessions.

## 1. Gap Analysis

- Existing system can plan multiple workers and execute independent task graph waves in parallel through `runOrchestrationWithRecorder` in `openclaw_runtime/src/agents/orchestrator-run-observed.ts`.
- Existing system can cap wave size through `maxWorkers` in `buildExecutionWaves` and can represent DAG dependencies in `OrchestrationTaskGraph`.
- Existing system can spawn each role as an independent subagent session through `openclaw_runtime/src/agents/role-spawn.ts`, preserving role contracts and tool permissions.
- Existing system can represent ClawGraph workflows with `control.maxParallel` and structured handoffs in `shared/types/clawgraph.ts`.
- The gap is not raw parallelism. The gap is resource-aware scheduling, deterministic fan-in/merge, conflict-aware write coordination across workers, and first-class evidence aggregation for parallel partial results.
- Today `maxWorkers` is a numeric cap, not a scheduler. It does not account for model/provider limits, token budget, file write sets, network/tool scarcity, or role risk.
- Today worker handoff is sufficient for summaries and evidence, but there is no explicit merge contract that says how a coordinator accepts, rejects, orders, or synthesizes multiple partial results.
- This matters for a personal agent platform because parallel work is useful only when it remains understandable and recoverable. A single developer needs to see why workers ran, what they touched, which outputs conflict, and which evidence the lead trusted.
- Existing non-goals respected: no new worker identity system, no replacement workflow engine, no peer-to-peer agent mesh as the default.

## 2. Architecture Overview

```text
[EXISTING] role-contract.ts / role-registry.ts
        |
        v
[EXISTING] role-router.ts -> [EXISTING] orchestrator.ts
        |                            |
        |                            v
        |                  [EXISTING] orchestration-protocol.ts
        |                            |
        |                            v
        |                 [NEW] ResourceAwareWaveScheduler
        |                            |
        v                            v
[EXISTING] role-spawn.ts -> [EXISTING] orchestrator-run-observed.ts
        |                            |
        |                            v
        |                 [NEW] ParallelRunCoordinator
        |                            |
        +----------------------------+------------------+
                         |                              |
                         v                              v
            [NEW] HandoffMergeContract       [NEW] ConflictAndResourceLedger
                         |                              |
                         v                              v
        [EXISTING] ClawGraphHandoff       [EXISTING] file-mutation-queue.ts
                         |
                         v
        [EXISTING] role-first-observer.ts / trace-buffer.ts
```

## 3. Component Specifications

### ResourceAwareWaveScheduler

Responsibility: Converts `OrchestrationExecutionWave[]` or ClawGraph ready nodes into executable batches that obey both dependency order and resource constraints. It does not choose worker identity; it schedules role-contract-backed nodes already selected by `orchestrator.ts` or ClawGraph compile.

Interfaces:

```ts
export interface WorkerResourceEstimate {
  taskNodeId: string;
  roleName: string;
  expectedTokens: number;
  expectedRuntimeMs?: number;
  writePaths?: string[];
  networkAccess: "none" | "limited" | "full";
  providerKey?: string;
  riskProfile: "low" | "medium" | "high" | "critical";
}

export interface ParallelResourcePolicy {
  maxConcurrentWorkers: number;
  maxConcurrentWritesPerPath: 1;
  maxProviderConcurrency?: Record<string, number>;
  maxHighRiskWorkers?: number;
  reserveVerifierCapacity: boolean;
}

export interface ScheduledWave {
  wave: number;
  batches: Array<{
    batchId: string;
    taskNodeIds: string[];
    reasons: string[];
  }>;
}
```

Internal state: Owns no durable state. It reads role permissions from `RoleContract`, node metadata from `OrchestrationTaskGraph`, and optional ClawGraph role/model/sandbox hints.

Lifecycle: Runs after `createOrchestratorPlan` and before worker spawn. For ClawGraph, it runs when nodes become ready.

Error handling strategy: If estimates fail, fall back to current `buildExecutionWaves` behavior with a diagnostic `resource-estimate-unavailable`.

### ParallelRunCoordinator

Responsibility: Executes scheduled batches, tracks in-flight workers, records lifecycle events, and feeds completion results into the merge contract. It wraps the current `Promise.allSettled` loop with richer state rather than replacing `runOrchestrationObserved`.

Interfaces:

```ts
export interface ParallelWorkerHandle {
  taskNodeId: string;
  roleName: string;
  childRunId?: string;
  childSessionKey?: string;
  status: "queued" | "running" | "accepted" | "failed" | "timeout";
  startedAt?: number;
  endedAt?: number;
}

export interface ParallelRunSnapshot {
  orchestrationRunId: string;
  graphRunId: string;
  handles: ParallelWorkerHandle[];
  activeBatchIds: string[];
  mergeStatus: "waiting" | "ready" | "partial" | "blocked";
}
```

Internal state: Owns in-memory run handles during execution and delegates durable run metadata to `SubagentRunRecord.orchestration`.

Lifecycle: Created per orchestration run, starts workers batch by batch, finalizes after all required worker nodes are terminal or blocked.

Error handling strategy: Worker spawn errors become normal worker failures. Coordinator continues other independent workers, marks merge as `partial`, and asks `buildRepairNodes`/`buildRerouteRecommendations` for next actions.

### HandoffMergeContract

Responsibility: Defines how a lead/coordinator consumes multiple worker handoffs. It validates required fields, groups evidence by node, identifies conflicts, and produces a Team Result Bundle merge summary for lead synthesis.

Interfaces:

```ts
export type MergeDecision = "accept" | "accept_partial" | "needs_repair" | "refute" | "defer_review";

export interface WorkerHandoffEnvelope {
  orchestrationRunId: string;
  taskNodeId: string;
  roleName: string;
  childRunId?: string;
  childSessionKey?: string;
  handoff: ClawGraphHandoff | TeamResultBundleChildOutcome;
}

export interface ParallelMergeResult {
  decision: MergeDecision;
  acceptedNodeIds: string[];
  rejectedNodeIds: string[];
  evidenceRefs: string[];
  filesTouched: string[];
  conflicts: Array<{ kind: "file" | "decision" | "evidence" | "scope"; nodeIds: string[]; message: string }>;
  synthesisInstructions: string[];
}
```

Internal state: Stateless validation and aggregation. It delegates evidence semantics to existing verifier paths and does not mutate Task Ledger or ClawGraph directly.

> REVIEW NOTE: `TeamResultBundleChildOutcome` is a proposed projection type, not an existing export — the runtime today has `ClawGraphHandoff` (`shared/types/clawgraph.ts:92`) as its only structured handoff contract, while `team-orchestrate-tool.ts` returns Team Result Bundle fields inline. Confirm whether the projection should live in `orchestration-protocol.ts` or `subagent-registry.types.ts`.

Lifecycle: Runs when each batch completes and again before verifier/lead synthesis.

Error handling strategy: Invalid or missing handoffs are converted into `needs_repair` items and review candidates, not silently dropped.

### ConflictAndResourceLedger

Responsibility: Keeps a bounded per-run record of resource decisions, write-path conflicts, and scheduler choices. It is a diagnostic ledger for orchestration, not the Task Ledger.

Interfaces:

```ts
export interface ResourceLedgerEvent {
  orchestrationRunId: string;
  taskNodeId?: string;
  type: "scheduled" | "deferred" | "started" | "write-conflict" | "resource-limit" | "merged";
  message: string;
  createdAt: number;
}
```

Internal state: In-memory ring plus optional trace attributes. It delegates long-term user-facing work state to Task Ledger and run state to ClawGraph/subagent registry.

Lifecycle: Created with `ParallelRunCoordinator`, appended during schedule/execute/merge, flushed into observability trace attributes at completion.

Error handling strategy: Ledger write failure must never block orchestration; it only degrades diagnostics.

### BoundedA2AAdviceChannel

Responsibility: Provides a future path for `workerCommunication = "bounded_a2a"` without enabling arbitrary worker chat. It allows workers to publish bounded, schema-validated handoff snippets to the coordinator; workers still do not directly steer each other.

Interfaces:

```ts
export interface BoundedWorkerMessage {
  orchestrationRunId: string;
  fromTaskNodeId: string;
  toTaskNodeId?: string;
  kind: "handoff_hint" | "blocker" | "evidence_ref";
  summary: string;
  evidenceRefs?: string[];
  expiresAt: number;
}
```

Internal state: Bounded per-run queue, size/TTL limited.

Lifecycle: Shadow only at first. The tool continues to report `boundedA2aEnabled: false` until parity evidence exists.

Error handling strategy: Invalid messages are ignored and recorded as diagnostics. The scheduler and lead synthesis must not depend on this channel in shadow mode.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `openclaw_runtime/src/agents/orchestration-protocol.ts` | Add `ParallelResourcePolicy`, resource estimates, merge result types, and optional scheduler diagnostics. | This file already owns orchestration policy and task graph types. |
| `openclaw_runtime/src/agents/orchestrator.ts` | Additive: include resource policy defaults in `OrchestratorPlan`; no change to role selection. | Planning should expose scheduler inputs without becoming the scheduler. |
| `openclaw_runtime/src/agents/orchestrator-run-observed.ts` | Replace direct wave `Promise.allSettled` loop with `ParallelRunCoordinator` in shadow/feature flag path; keep old loop as fallback. | Execution already has the right span/lifecycle surface; change must be additive. |
| `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts` | Accept optional `resourcePolicy`; continue to disable `bounded_a2a` until separate pilot. | Tool boundary is where user/model-callable orchestration policy enters. |
| `openclaw_runtime/src/agents/role-spawn.ts` | No identity change; optionally pass estimated resource metadata in orchestration context. | Roles remain identity and permissions source. |
| `openclaw_runtime/src/agents/subagent-registry.types.ts` | Add optional resource/merge metadata to `TeamOrchestrationMetadata`. | Existing subagent records are the durable per-child orchestration metadata carrier. |
| `shared/types/clawgraph.ts` | Add optional node resource hints and merge/audit annotations, preserving current `ClawGraphHandoff`. | ClawGraph already has DAG and handoff contracts; only resource hints are missing. |
| `openclaw_runtime/src/observability/role-first-observer.ts` | Add spans or attributes for scheduling, resource deferrals, merge decisions, and conflicts. | Parallelism must be explainable in Observability. |
| `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts` | No change initially. | Existing per-file serialization remains the low-level write safety primitive. |
| `shared/types/task-ledger.ts` | No change. | Task Ledger is not the orchestration executor. |

## 5. Data Flow

Scenario: a lead asks `team_orchestrate` to update docs, implement code, and verify tests.

1. `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts` validates parameters and normalizes quality/repair/communication policy.
2. `createOrchestratorPlan` in `openclaw_runtime/src/agents/orchestrator.ts` uses `role-router.ts` or a template to produce role workers, a verifier, `taskGraph`, and `executionWaves`.
3. `ResourceAwareWaveScheduler` reads the graph, `RoleContract` permissions, optional file hints, provider/model refs, and resource policy. It splits the original wave into batches if two workers target the same write path or exceed provider concurrency.
4. `ParallelRunCoordinator` starts the first batch through existing `spawnRoleSubagent` and `spawnSubagentDirect`. Each worker gets its own child session; workers do not share a parent session actor queue.
5. `orchestrator-run-observed.ts` records subagent spans and lifecycle events as it does today. The coordinator also records scheduling/conflict attributes.
6. Worker output is parsed into `WorkerHandoffEnvelope`. For ClawGraph-backed nodes, the envelope uses `ClawGraphHandoff`; for team orchestration, the same fields are projected from the Team Result Bundle child outcome.
7. `HandoffMergeContract` validates each handoff, aggregates `evidenceRefs`, `filesTouched`, `decisions`, `deviations`, and `risks`, and emits conflicts.
8. If the merge is clean, the verifier starts after required workers reach terminal state, using the merged evidence. If not clean, `buildRepairNodes` and `buildRerouteRecommendations` propose repair or review.
9. The result returned by `team_orchestrate` keeps the existing Team Result Bundle shape and adds optional scheduler/merge diagnostics.
10. Lead synthesis remains push-based: the lead waits for completion events rather than polling child sessions.

## 6. Migration Path

- Shadow phase:
  - Compute resource schedules beside current `executionWaves`, but execute with the existing loop.
  - Validate handoffs and produce merge diagnostics without changing verifier/lead behavior.
  - Record where the scheduler would have deferred work due to file/provider/risk constraints.
- Pilot gate:
  - New harness task spec for parallel scheduling.
  - Feature flag default off.
  - Disable-only rollback to the current `Promise.allSettled` wave loop.
  - No required schema migrations; all new metadata optional.
  - Demonstrated parity for current role-first orchestration and Subagent Runner presets.
- Active pilot:
  - Enable resource-aware scheduling only for `team_orchestrate` and explicit worker arrays.
  - Keep ClawGraph scheduling in shadow until workflow tests prove maxParallel/resource interactions.
  - Keep `bounded_a2a` disabled.
- Telemetry:
  - Planned vs actual concurrency, deferral reasons, worker duration, provider contention, file conflict count, merge decision, verifier outcome, repair node count, and lead synthesis success.
- Rollback:
  - Disable scheduler flag.
  - Ignore optional metadata in subagent records.
  - Keep existing Team Result Bundle fields stable.

## 7. Design Decisions

- Decision: Treat current wave parallelism as production foundation, not as a gap to replace. Why: `orchestrator-run-observed.ts` already runs ready nodes concurrently with `Promise.allSettled`.
- Alternative rejected: Build a new orchestration executor separate from role-first orchestration. That would duplicate role contracts, subagent lifecycle, and observability.
- Decision: Workers get independent child sessions. Why: `SessionActorQueue` (`openclaw_runtime/src/acp/control-plane/session-actor-queue.ts`) enforces per-session ordering; parallel workers sharing one session would serialize turns and mix transcripts.
- Alternative rejected: Put all workers in the parent session. This would undermine bounded prompts and make evidence attribution harder.
- Decision: Merge through structured handoffs, not free-form worker-to-worker chat. Why: ClawGraph handoff already has evidence, files, decisions, deviations, risks, follow-ups, and confidence.
- Alternative rejected: Enable `bounded_a2a` immediately. The public tool currently reports it disabled, so it needs a separate shadow/pilot path.
- Future extension points: ClawGraph node resource hints, adaptive model/provider scheduling, bounded A2A advice, stronger file conflict analysis, and UI display of scheduler decisions.

## 8. Validation Approach

- Unit tests for `ResourceAwareWaveScheduler` with dependency graphs, max concurrency, provider caps, high-risk caps, and write-path conflicts.
- Golden tests proving existing `buildExecutionWaves` output remains unchanged when the scheduler flag is off.
- Integration tests for `team_orchestrate` explicit workers returning the same Team Result Bundle fields plus optional diagnostics.
- ClawGraph compile/run tests where `control.maxParallel` and resource hints produce expected batches.
- Conflict tests using `file-mutation-queue.ts` to verify independent files run in parallel while same-file writes serialize.
- Observability tests confirming scheduler, subagent, verifier, and merge spans are correlated by `orchestrationRunId`.
- Success metrics: no behavior change in shadow mode, fewer same-file worker conflicts, bounded provider concurrency, deterministic merge summaries, and no regression in worker completion delivery.
