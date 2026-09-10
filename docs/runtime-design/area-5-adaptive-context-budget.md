# 5. Adaptive Context Budget

## Exploration Log

> FAILURE NOTE: The mandatory CodeGraph steps could not be executed because no CodeGraph MCP tools are exposed in this session. MCP resource and template discovery returned no usable CodeGraph surface, and `rtk` was not available on PATH. I continued with targeted source reads and record this as a tooling failure, not a design blocker.

- CodeGraph plans executed: `codegraph_decide` and `codegraph_context_plan` were required by the prompt but unavailable. Manual fallback followed the plan's named files and repo path discovery.
- Files read:
  - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts`: production five-tier pressure ladder from `tier0` hot context through `tier4` emergency collapse; `planCompression` adds micro-compaction, token pruning, and emergency collapse steps by tier.
  - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`: production `CompressionArtifact v1` schema, quality scoring, evidence references, stale exclusion count, causal anchor count, warnings, and projection token fields.
  - `openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts`: production reactive pruning that drops thinking blocks, soft-trims tool results, hard-clears prunable tool results, and preserves bootstrap plus recent assistant tail.
  - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`: production compaction safeguard — recent-turn preservation (default 3, max 12), summary quality contract (required sections: Decisions, Open TODOs, Constraints/Rules, Pending user asks, Exact identifiers), quality repair, and re-distillation. Note the plan's stated path `src/agents/agent-hooks/compaction-safeguard.ts` resolves under `openclaw_runtime/`.
  - `openclaw_runtime/src/context-engine/types.ts`: Context Engine public lifecycle, `ContextEngineHostCapability`, `ContextEngineRuntimeContext`, and existing budget fields such as `tokenBudget`, `currentTokenCount`, `promptCache`, and deferred compaction support.
  - `openclaw_runtime/src/context-engine/provider-registry.ts`: shadow/pilot context provider registry bridge around legacy context and `LoopContextPack`; providers have `priority`, `order`, `enabledByDefault`, `shadowOnly`, isolated errors (`runIsolatedContextProvider`), and diagnostics-only grounding shadow metadata.
  - `openclaw_runtime/src/context-engine/registry.ts`: separate from the provider registry — this file owns context *engine* registration, resolution, compatibility checks, and the runtime quarantine proxy (`wrapContextEngineWithRuntimeQuarantine`) that isolates a misbehaving engine. Budget planning attaches to the runtime context that flows through this layer; it does not modify quarantine behavior.
  - `docs/clawx-design-overview.md`: confirms automatic compaction is telemetry-only until evaluation gates prove safety, Local Runtime Control Plane has no active context pruning, manual compaction is not task truth, and `CompressionArtifact v1` is the preferred recovery artifact.
- Existing modules found:
  - Production: `compression-planner.ts`, `compression-artifact.ts`, `context-pruning/pruner.ts`, `compaction-safeguard.ts`, `context-engine/types.ts`, `context-engine/registry.ts`.
  - Shadow/pilot: `context-engine/provider-registry.ts` and grounding shadow consumer diagnostics; automatic compaction telemetry path described in `docs/clawx-design-overview.md`.
  - Planned/bounded: Context provider registry promotion beyond diagnostics, active Local Runtime Control Plane context pruning, and automatic compaction promotion.
- Non-goals and constraints identified:
  - Do not replace the five-tier pressure model or `CompressionArtifact v1`.
  - Do not make automatic compaction active without shadow evaluation gates.
  - Do not let the Local Runtime Control Plane perform active pruning.
  - Do not mutate Task Ledger from compaction or treat compaction as proof of completion.
  - Do not replace the legacy Context Engine or `LoopContextPack` while the provider registry is shadow-only.

## 1. Gap Analysis

- What exists today:
  - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts` can react to measured pressure with deterministic tiers (`tier0`–`tier4`, threshold literals at compression-planner.ts:107-111): hot context below `0.6`, micro-compact below `0.75`, token-pruning below `0.85`, semantic-handoff below `0.95`, and emergency-collapse at or above `0.95`.
  - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts` stores structured recovery state with objective, constraints, work buckets, decisions, evidence refs, unverified claims, quality score, artifact tokens, projection tokens, stale exclusions, and causal anchors.
  - `openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts` can reduce context after pressure is present while protecting bootstrap context and recent assistant tail.
  - `openclaw_runtime/src/context-engine/types.ts` already passes `tokenBudget` and `currentTokenCount` through assemble, after-turn, and compact surfaces.
  - `openclaw_runtime/src/context-engine/provider-registry.ts` can run context providers in a shadow-only, diagnostics-preserving registry with provider priority/order metadata.
- What is missing:
  - There is no pre-turn budget plan that predicts how much context a task should reserve for source inspection, tool output, reasoning, verification, and recovery.
  - Compression tier thresholds are task-agnostic; a small locate task and a risky refactor hit the same pressure ladder.
  - Provider selection is not budget-aware in active behavior. Provider manifests expose priority/order, but there is no planner that spends a bounded context budget across providers.
  - Compression cost is measured mostly as token reduction and artifact quality, not as a total-cost tradeoff where aggressive compression can increase reasoning burden, tool retries, or missed evidence.
- Why it matters:
  - A personal local agent platform often runs long exploratory tasks where context pressure arrives late. By then, the system may already have retained low-value history and squeezed out high-value constraints.
  - Proactive budgeting gives the runtime a way to keep room for verification and recovery before the transcript is full.
- Non-goals respected:
  - The design does not replace compaction, Task Ledger, memory, observability, or `LoopContextPack`.
  - It does not promote active automatic compaction immediately.
  - It keeps Local Runtime Control Plane diagnostics observe-only.

## 2. Architecture Overview

```text
[EXISTING] user turn / role / ClawGraph node
        |
        v
[NEW] TaskComplexityEstimator
        |
        v
[NEW] ContextBudgetPlanner -----------------------------+
        |                                               |
        | ContextBudgetPlan                             |
        v                                               |
[EXISTING] ContextEngineRuntimeContext                  |
        |                                               |
        +--> [NEW] BudgetAwareProviderRanker ---------->|
        |       |                                       |
        |       v                                       |
        |  [EXISTING] provider-registry.ts              |
        |       | shadow provider diagnostics           |
        v                                               |
[EXISTING] compression-planner.ts <--- [NEW] CompressionCostModel
        |
        v
[EXISTING] compression-artifact.ts quality fields
        |
        v
[NEW] BudgetShadowEvaluator
        |
        v
[EXISTING] Local Runtime Control Plane context report
```

The architecture adds a planning layer before context assembly. The existing pressure ladder remains authoritative for actual compression until shadow evaluation proves that planned thresholds are safer than the current constants.

## 3. Component Specifications

### ContextBudgetPlanner

Responsibility: Builds a per-turn budget plan before prompt assembly. It divides the available model window into reserved slices for instructions, recent conversation, retrieved context, tool output, verification evidence, compression artifact projection, and emergency headroom. In shadow phase, it records the plan but does not change prompt assembly.

Interfaces:

```ts
type ContextBudgetPlan = {
  version: 1;
  mode: "shadow" | "advisory" | "active";
  taskKind: "locate" | "explain" | "edit" | "refactor" | "test" | "review" | "long_task" | "unknown";
  totalBudgetTokens: number;
  reserved: {
    systemAndRules: number;
    recentConversation: number;
    providerContext: number;
    toolOutput: number;
    verification: number;
    recoveryProjection: number;
    emergencyHeadroom: number;
  };
  pressureSchedule: {
    microCompactAt: number;
    tokenPruneAt: number;
    semanticHandoffAt: number;
    emergencyCollapseAt: number;
  };
  providerBudgets: Record<string, number>;
  evidenceRefs: Array<{ type: string; ref: string; label?: string }>;
};

type ContextBudgetPlannerInput = {
  sessionId?: string;
  roleId?: string;
  prompt: string;
  modelContextWindow?: number;
  tokenBudget?: number;
  currentTokenCount?: number;
  availableProviders: Array<{ id: string; priority: number; shadowOnly?: boolean }>;
  compressionArtifactQuality?: { score: number; level: "good" | "warn" | "bad" };
};
```

Internal state: Owns no durable task truth. It may keep an in-memory rolling calibration map keyed by task kind and model family. Durable diagnostics are delegated to Local Runtime Control Plane reports or compaction telemetry.

Lifecycle: Created with the runtime context engine or turn runner, invoked before `ContextEngine.assemble`, attached as optional runtime context metadata, and discarded after the turn except for diagnostics.

Error handling: On estimation failure, returns a conservative `unknown` plan with current production pressure thresholds. It never blocks a turn.

### TaskComplexityEstimator

Responsibility: Classifies the turn before execution using prompt shape, role, ClawGraph node metadata when present, file mention count, requested validation, and whether the turn is part of `/loop` or Mission Control.

> REVIEW NOTE: Classification should start as deterministic heuristics (prompt keywords, role contract, node kind), not an extra model call — an LLM pre-classifier would add latency and cost to every turn, which contradicts the budget goal. If heuristics prove too coarse during shadow evaluation, a cached per-role default schedule is the cheaper next step.

Interfaces:

```ts
type TaskComplexityEstimate = {
  taskKind: ContextBudgetPlan["taskKind"];
  complexity: "small" | "medium" | "large" | "uncertain";
  risk: "low" | "medium" | "high";
  expectedToolOutputTokens: number;
  requiresVerificationBudget: boolean;
  reasons: string[];
};
```

Internal state: Stateless by default. Optional future calibration can read shadow outcomes but must not write task state.

Lifecycle: Runs before `ContextBudgetPlanner`; can also be called by ClawGraph node scheduling or role-first orchestration to annotate worker prompts.

Error handling: Ambiguous classification becomes `unknown` and `uncertain`, preserving current runtime behavior.

### BudgetAwareProviderRanker

Responsibility: Uses provider manifests from `openclaw_runtime/src/context-engine/provider-registry.ts` to allocate token slices across providers. It respects provider `priority`, `order`, `enabledByDefault`, `shadowOnly`, `outputKinds`, and `dependsOnIndexing`, while also considering task kind.

Interfaces:

```ts
type ProviderBudgetDecision = {
  providerId: string;
  tokenBudget: number;
  rank: number;
  include: boolean;
  reason: "task_relevant" | "priority" | "budget_exhausted" | "shadow_only" | "index_unavailable";
  diagnosticOnly: boolean;
};

type BudgetAwareProviderRanker = {
  rank(input: {
    plan: ContextBudgetPlan;
    providers: RuntimeContextProviderManifest[];
  }): ProviderBudgetDecision[];
};
```

Internal state: None. It delegates provider execution and error isolation to `RuntimeContextProviderRegistry` and `runIsolatedContextProvider`.

Lifecycle: Runs after the budget plan is created and before provider queries are issued. In shadow phase, it compares its ranking against existing provider behavior without changing prompt text.

Error handling: Provider metadata gaps fall back to manifest priority/order. Provider failures remain isolated by `provider-registry.ts`.

### CompressionCostModel

Responsibility: Estimates whether compression is likely to reduce total work or merely move work into later reasoning. It compares planned compression savings against artifact quality, evidence coverage, unverified claim count, retry count, and downstream verification misses.

Interfaces:

```ts
type CompressionCostEstimate = {
  strategy: "hot-context" | "micro-compact" | "token-pruning" | "semantic-handoff" | "emergency-collapse";
  expectedInputSavingsTokens: number;
  expectedReasoningPenaltyTokens: number;
  expectedRetryRisk: "low" | "medium" | "high";
  minArtifactQualityScore: number;
  recommendation: "avoid" | "allow" | "prefer";
  reasons: string[];
};
```

Internal state: Shadow calibration records keyed by strategy and task kind. No transcript, ledger, or memory state is owned.

Lifecycle: Called by `ContextBudgetPlanner` to set pressure schedule and by `BudgetShadowEvaluator` after a turn to compare expectation with actual quality.

Error handling: Missing quality data yields a neutral estimate and current production thresholds.

### BudgetShadowEvaluator

Responsibility: Compares shadow plans with actual turn outcomes: maximum pressure reached, compression tier selected by `compression-planner.ts`, `CompressionArtifact.quality`, provider diagnostics, evidence misses, and whether the user-visible task completed.

Interfaces:

```ts
type BudgetShadowReport = {
  kind: "context_budget";
  mode: "shadow";
  sessionId?: string;
  plan: ContextBudgetPlan;
  observed: {
    maxPressure: number;
    actualStrategy?: string;
    artifactQualityScore?: number;
    evidenceCoverage?: number;
    unverifiedClaimCount?: number;
    providerTokenUse: Record<string, number>;
  };
  verdict: "better_than_baseline" | "same_as_baseline" | "worse_than_baseline" | "inconclusive";
  promotionBlockers: string[];
};
```

Internal state: Bounded in-memory reports, optionally mirrored into the same diagnostics path used by Local Runtime Control Plane. It does not own durable reports unless a future LCP report store is explicitly designed.

Lifecycle: Starts after a plan is generated, finalizes after compaction/turn telemetry is available, then emits diagnostics.

Error handling: Missing telemetry produces `inconclusive`, never an active change.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|-----------------|-----------------|-----------|
| `openclaw_runtime/src/context-engine/types.ts` | Add optional `contextBudgetPlan?: ContextBudgetPlan` to `ContextEngineRuntimeContext`; avoid method signature changes where possible. | Existing assemble/afterTurn/compact calls already carry runtime context and token fields, making this the smallest additive surface. |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts` | Add optional planner input such as `pressureSchedule?: Partial<CompressionPressureSchedule>`; absent input preserves current threshold literals. | Lets shadow and later active pilots compare task-aware thresholds without replacing the production five-tier model. |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts` | No schema replacement. Optionally add non-authoritative budget diagnostics outside `CompressionArtifact v1`, or only optional metadata if schema evolution is accepted. | The artifact is production recovery state; budget evaluation should not destabilize it. |
| `openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts` | No active change in phase 1. Later pilot may consume planned recent-tail and tool-output budgets. | Current pruning is production reactive behavior and should remain the fallback. |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` | No change. | The safeguard's quality contract and recent-turn preservation are production behavior; the budget layer observes its outcomes (via `CompressionArtifact.quality`) rather than modifying it. |
| `openclaw_runtime/src/context-engine/provider-registry.ts` | Add optional ranker diagnostics to provider pilot results; do not make registry authoritative. | The registry already has priority/order and shadow-only diagnostics, ideal for budget-provider experiments. |
| `openclaw_runtime/src/local-control-plane/index.ts` | Add observe-only `context_budget` or extend `context` report metadata with budget plan/outcome. | Maintains LCP's diagnostic boundary while making budget evaluation visible. |
| `docs/clawx-design-overview.md` | Update only after the design is implemented, documenting proactive budget as shadow telemetry. | Functional architecture docs should match behavior once code exists. |

## 5. Data Flow

Scenario: a user asks for a medium refactor with tests.

1. The turn runner prepares runtime context and calls `TaskComplexityEstimator` with the prompt, role, model window, and any ClawGraph or Mission metadata.
2. `TaskComplexityEstimator` classifies the task as `refactor`, `medium`, `medium` risk, and marks verification budget as required.
3. `ContextBudgetPlanner` creates a `ContextBudgetPlan` that reserves more room for tool output and verification than a locate task would, keeps emergency headroom, and recommends slightly earlier micro-compaction but avoids early emergency collapse.
4. `BudgetAwareProviderRanker` reads provider manifests exposed through `openclaw_runtime/src/context-engine/provider-registry.ts`. In shadow phase, it records that symbol/context providers would receive more budget and legacy message context less, but existing prompt assembly remains authoritative.
5. `ContextEngine.assemble` proceeds with existing `tokenBudget` behavior from `openclaw_runtime/src/context-engine/types.ts`; the optional plan rides along in runtime context for telemetry.
6. If pressure rises, `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts` still selects the current production tier. Shadow telemetry also records which planned tier would have been selected.
7. If compaction occurs, `compression-artifact.ts` records `CompressionArtifact.quality`; `CompressionCostModel` compares expected savings against quality and evidence coverage.
8. `BudgetShadowEvaluator` emits an observe-only report to the LCP context diagnostics path. No prompt text, provider ordering, pruning, or compaction behavior changes in shadow mode.

## 6. Migration Path

- Shadow phase:
  - Generate `ContextBudgetPlan` for every eligible turn where token budget information is available.
  - Do not alter provider ordering, compression thresholds, prompt text, pruning behavior, or Task Ledger.
  - Collect planned-vs-actual pressure, chosen compression tier, artifact quality score, evidence coverage, retry count, and provider diagnostics.
- Advisory phase:
  - Surface budget diagnostics in developer reports and optional logs.
  - Allow manual inspection of cases where the planner would have compressed earlier or spent provider budget differently.
  - Keep all runtime decisions unchanged.
- Active pilot:
  - Behind a default-off feature flag and fresh task spec.
  - Scope to one low-risk task kind first, such as `locate` or `explain`.
  - Enable only additive threshold input to `compression-planner.ts`; current literals remain rollback fallback.
- Promotion gates:
  - No statistically meaningful drop in `CompressionArtifact.quality.score`.
  - Lower or equal unverified-claim and evidence-gap rates.
  - Lower maximum pressure or fewer emergency-collapse events for comparable tasks.
  - No increase in failed compaction recovery or provider errors.
- Rollback:
  - Disable the feature flag.
  - Ignore `contextBudgetPlan` optional fields.
  - Fall back to current pressure constants and provider behavior without schema migration.

## 7. Design Decisions

- Decision: Add proactive planning before context assembly instead of changing compaction first.
  - Why: The gap is prediction and allocation, while compaction already works as the reactive safety net.
  - Alternative rejected: Rewrite `compression-planner.ts` as a task-aware planner. That would put experimental classification into production recovery code.
  - Extension point: Later pilots can pass a planned threshold schedule into the existing planner.
- Decision: Use provider manifests for budget allocation.
  - Why: `provider-registry.ts` already models provider priority, order, output kinds, shadow status, and isolated errors.
  - Alternative rejected: Create a separate context source registry. That would duplicate the existing pilot surface.
  - Extension point: Additional providers can expose estimated token cost and task-kind affinity.
- Decision: Keep `CompressionArtifact v1` stable.
  - Why: It is production recovery state and should not absorb every diagnostic experiment.
  - Alternative rejected: Bump the artifact schema for budget telemetry immediately.
  - Extension point: Optional metadata can be added later if shadow reports prove it belongs in recovery artifacts.
- Decision: Treat compression cost as total work, not only input-token savings.
  - Why: Over-compression can make later reasoning more expensive and less reliable even when prompt tokens shrink.
  - Alternative rejected: Optimize only for context-window pressure.
  - Extension point: The cost model can incorporate scorecard, evidence verifier, and trace metrics later.

## 8. Validation Approach

- Run shadow evaluation on representative task classes: locate, explanation, small edit, refactor, test repair, review, and long-task continuation.
- Metrics:
  - Planned pressure vs actual max pressure.
  - Emergency-collapse frequency.
  - `CompressionArtifact.quality.score`, field coverage, evidence coverage, and warning count.
  - Unverified claim count and evidence-gap findings.
  - Tool retry count and repeated file reads after compression.
  - Provider diagnostic error rate and omitted context item count.
  - Total input tokens plus estimated reasoning penalty, not input tokens alone.
- Experiments:
  - Compare current fixed thresholds against shadow task-aware schedules.
  - Compare current provider ordering against budget-aware rankings without changing prompt text.
  - Inspect cases where budget-aware planning would have preserved more verification budget.
  - Confirm disabling the feature flag restores byte-for-byte current threshold behavior where possible.

## 9. Round 2 Affirmed Design Strengths

The following Round 2 decision is affirmed and must be preserved in implementation.

### 9.1 Wave immutability: A5 budget changes apply to next wave only

**Decision** (recorded as OQ-COMP-02 in Round 2 open-questions registry): When A5 modifies budget estimates after A2 has started a wave, the change applies only to the next wave. The currently-running wave is immutable — its worker count and token allocation cannot be reduced mid-flight.

**Why affirmed**: Captures a hidden architectural invariant as an explicit decision rather than leaving it implicit. Prevents mid-wave worker count changes that would break `HandoffMergeContract` assumptions, `SessionActorQueue` per-session ordering, and `ParallelRunCoordinator` in-flight tracking. Without this decision, A5+A2 composition would have undefined behavior on budget updates.

**Implementation constraint**: `ContextBudgetPlanner` output must carry an `appliesToWave: number` field indicating which wave index the plan targets. `ResourceAwareWaveScheduler` must not re-plan or modify a wave that has already started (i.e., whose workers have been spawned). A5 may emit updated plans at any time, but they queue for the next wave. If no next wave exists, the updated plan is recorded as telemetry only.
