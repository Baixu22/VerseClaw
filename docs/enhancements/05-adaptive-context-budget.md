# 5. Adaptive Context Budget

Status: DESIGN ONLY — no implementation in this document. Proposed maturity path: shadow → pilot → active, per the repo's pilot pattern (fresh spec, explicit operator gate, default-off, disable-only rollback, no schema change, documented rollback plan).

> T1 update (2026-07-13): the context provider registry pilot runner was
> deleted after its test consumers migrated to direct
> `RuntimeContextProviderRegistry` construction. Provider-budget portions of
> this design now require a fresh owner/spec and must not revive the deleted
> runner or its three-flag gate.

See also (sibling designs, by filename + scope only): `01-layered-execution-isolation.md` (execution sandboxing layers); `02-parallel-multi-agent-orchestration.md` (per-worker token budgets — its worker budget vocabulary and this document's per-task budgets intentionally share `budgetTokens` / `reserveRatio` naming); `03-runtime-resilience-supervisor.md`; `04-decision-quality-assessment.md`; `06-session-continuity.md`.

## Exploration Log

**CodeGraph note.** This repo vendors CodeGraph as a runtime extension (`openclaw_runtime/extensions/codegraph/`) whose 15 tools (`codegraph_decide`, `codegraph_context_plan`, `codegraph_search`, `codegraph_impact`, …) are registered for the runtime's own agents. They are NOT connected to this design session. Direct-exploration equivalent performed instead: `Grep` for tier/threshold/quality/capability identifiers across `openclaw_runtime/packages/agent-core/src/harness/compaction/`, `openclaw_runtime/src/context-engine/`, `openclaw_runtime/src/agents/`, plus full `Read` of every planner/artifact/type file below and targeted reads of `docs/clawx-design-overview.md` (§1.2 non-goals at line 30, §5.2 sub-domains at line 253, §8.5.1 at line 739).

**Files read** (repo-relative; maturity label per module):

- `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts` — FULL. The 5-tier pressure-reactive planner. **production**.
- `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts` — FULL. `CompressionArtifact` v1 + `quality` scoring. **production**.
- `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts` — first ~260 lines + export map + `prepareCompaction` region. `CompactionSettings`, `shouldCompact`, `CompactionDetails`, `planCompression` call sites at compaction.ts:792 and compaction.ts:801. **production** (~29 KB).
- `openclaw_runtime/packages/agent-core/src/harness/compaction/branch-summarization.ts` — export skim. Branch summary generation. **production**.
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` — first ~130 lines + exports (`compactionSafeguardExtension` default export at compaction-safeguard.ts:880). Recent-turn preservation defaults, quality-guard retries. **production** (~50 KB — any change here must be additive, never a rewrite).
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts` — FULL. Required summary sections + audit. **production**.
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts` + `settings.ts` — FULL. Cache-TTL tool-result pruning; config-gated (`mode: "cache-ttl"` required, otherwise `computeEffectiveSettings` returns null). **production**, opt-in by config.
- `openclaw_runtime/src/context-engine/types.ts` — FULL. `ContextEngine` lifecycle (bootstrap → ingest → assemble → compact → maintain → afterTurn, plus thread-bootstrap projection), `ContextEngineHostCapability`. **production** contract.
- `openclaw_runtime/src/context-engine/registry.ts` — first ~130 lines. Engine registration + runtime quarantine proxy (`RUNTIME_QUARANTINE_PROXY_STATE`, registry.ts:61). **production**.
- `openclaw_runtime/src/context-engine/provider-registry.ts` — FULL. Compatibility provider factories remain `shadowOnly: true`, `enabledByDefault: false`, and legacy-authoritative; the unused registry pilot runner was deleted in T1.
- `openclaw_runtime/src/context-engine/shadow-flags.ts` — FULL. `contextProviderShadowFlagEnabled` helper. **shadow** infrastructure (ADVISORY_ONLY flag reads).
- `openclaw_runtime/src/agents/agent-compaction-constants.ts` — FULL. `MIN_PROMPT_BUDGET_TOKENS = 8_000`, `MIN_PROMPT_BUDGET_RATIO = 0.5`. **production**.
- `openclaw_runtime/src/agents/bootstrap-budget.ts` — FULL. Bootstrap-file char budgets, `DEFAULT_BOOTSTRAP_NEAR_LIMIT_RATIO = 0.85` (bootstrap-budget.ts:10), truncation causes `per-file-limit` / `total-limit`, once/always warning dedupe. **production**.
- `openclaw_runtime/extensions/codegraph/README.md` + `index.ts` (targeted grep). `codegraph_decide` operation vocabulary at index.ts:218. **production** extension (runtime-agent tools).
- `openclaw_runtime/src/gateway/methods/core-descriptors.ts` (targeted grep) — `sessions.compactionHistory` / `sessions.compressionArtifact` RPCs at core-descriptors.ts:218-219. **production**.
- `docs/clawx-design-overview.md` — §1.2 non-goals, §5.2 sub-domains, §8.5.1 Long Conversation Control and Manual Compaction.

**Verified threshold facts** (`compression-planner.ts:107-111`, function `selectCompressionPlan`): pressure = `tokensBefore / budget` where budget = `contextWindow ?? settings.contextWindow ?? settings.reserveTokens + settings.keepRecentTokens` (compression-planner.ts:100-106). Tiers: pressure < 0.6 → `tier0` / `"hot-context"`; < 0.75 → `tier1` / `"micro-compact"`; < 0.85 → `tier2` / `"token-pruning"`; < 0.95 → `tier3` / `"semantic-handoff"`; ≥ 0.95 → `tier4` / `"emergency-collapse"`. This matches the claimed ladder exactly.

**Verified artifact facts** (`compression-artifact.ts:33-61`): `CompressionArtifact` v1 = `{ schemaVersion: 1, objective, constraints, currentState, done, inProgress, blocked, decisions, filesTouched, testsRun, failedAttempts, deviations, nextAction, reviewNeeded, evidenceRefs, unverifiedClaims, quality, tier?, strategy?, compressionRatio?, tokensBefore?, tokensAfter?, rehydratedFiles?, rehydratedFileContext?, staleExcludedCount?, causalAnchorCount?, warnings? }`. `quality` is `CompressionArtifactQuality = { score: number; level: "high" | "medium" | "low"; fieldCoverage: number; evidenceCoverage: number; artifactTokens: number; projectionTokens: number; warnings: string[] }` (compression-artifact.ts:23-31), scored as `fieldCoverage*0.45 + evidenceCoverage*0.35 + tokenBudgetBonus(0.2|0.05)`, level cutoffs 0.82 / 0.6 (compression-artifact.ts:300-306).

**Verified capability enum** (`context-engine/types.ts:53-60`): `ContextEngineHostCapability = "bootstrap" | "assemble-before-prompt" | "after-turn" | "maintain" | "compact" | "runtime-llm-complete" | "thread-bootstrap-projection"`.

**Path/section corrections logged:**

1. The telemetry-only compaction rule is not inside §8.5.1's body. Its wording lives in the §1 scope bullet list of `docs/clawx-design-overview.md` (line 25): *"automatic compaction records telemetry until evaluation gates prove the new strategy is safe to promote."* §8.5.1 (line 739) documents the manual-compaction control layer, RPC surface, and `CompressionArtifact v1` recovery-query surface. This design treats the line-25 wording as the governing rule.
2. `agent-compaction-constants.ts` contains only the two prompt-budget constants; the real tier thresholds are inline literals in `selectCompressionPlan`, not named constants. The parameterization below therefore introduces named defaults where none exist yet.
3. The design direction's suggested task class `edit` is renamed to `modify` to match the codegraph `OperationType` union verbatim (`"answer" | "locate" | "explain" | "modify" | "debug" | "test" | "refactor" | "review"`, `extensions/codegraph/index.ts:218`).

**Non-goals identified** (respected throughout): Verse Claw is not an AI engine and never calls models directly (§1.2); compaction summaries "must not mutate Task Ledger automatically" (§8.5.1 state separation); automatic compaction stays telemetry-only until gates pass (§1 scope, line 25); ClawGraph/Task Ledger/observability boundaries from §8.5.3 are untouched.

## 1. Gap Analysis

### What the system CAN do today

- **React to pressure with a 5-tier ladder.** `selectCompressionPlan` (`openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts`, production) maps the current pressure ratio to `hot-context` → `micro-compact` → `token-pruning` → `semantic-handoff` → `emergency-collapse`, and `planCompression` applies tier-appropriate message surgery (micro-compaction of ≥1200-char messages at tier1+, causal-anchor token pruning at targetRatio 0.45 for non-hot messages at tier2+, objective/next-action/last-4 retention at tier4).
- **Trigger reactively.** `shouldCompact` (`compaction.ts:249-258`, production) fires only when `contextTokens > contextWindow - reserveTokens` — i.e. when the window is nearly full. §8.5.1 confirms the runtime keeps "automatic pre-prompt pressure checks and overflow routing (`truncate_tool_results_only`, `compact_only`, `compact_then_truncate`)".
- **Measure compression quality after the fact.** Every compaction persists `CompactionDetails { readFiles, modifiedFiles, compression?: CompressionTelemetry, artifact?: CompressionArtifact }` on the compaction entry (`compaction.ts:51-60`, production), and the artifact carries a computed `quality` block. `sessions.compactionHistory` / `sessions.compressionArtifact` (production RPCs) expose this history.
- **Guard summary quality.** `compaction-safeguard.ts` (production, ~50 KB) preserves `DEFAULT_RECENT_TURNS_PRESERVE = 3` recent turns (max 12), retries low-quality summaries (`DEFAULT_QUALITY_GUARD_MAX_RETRIES = 1`, max 3), and `compaction-safeguard-quality.ts` enforces the five required sections (`## Decisions`, `## Open TODOs`, `## Constraints/Rules`, `## Pending user asks`, `## Exact identifiers`).
- **Trim independently of compaction.** Cache-TTL context pruning (`context-pruning/pruner.ts`, production, config-gated) soft-trims prunable tool results at ratio 0.3 and hard-clears at 0.5 of the char window.
- **Budget bootstrap injection.** `bootstrap-budget.ts` (production) already speaks a budget vocabulary — per-file/total char limits, `nearLimitRatio` 0.85, truncation warnings.
- **Describe context sources.** The `ContextEngine` contract (production) assembles under an optional `tokenBudget`, and compatibility provider manifests retain `priority` / `order`; no production registry runner currently consumes them.
- **Classify tasks deterministically (prior art).** `codegraph_decide` (production extension) infers `OperationType` from cheap keyword heuristics (e.g. "refactor/重构/rename/extract" → `refactor`, "where/在哪/find/entrypoint" → `locate`, `extensions/codegraph/index.ts:595,600`) and derives risk/freshness policy from it — without a model call.

### What the system CANNOT do (the precise gap)

1. **No budget is planned before execution.** Nothing estimates, at turn 1, how many turns a task will take or how much context it will consume. The first compression decision happens when pressure already crossed 0.75 (or overflow routing fires at the window edge). A 40-turn refactor and a 4-turn locate get the identical schedule.
2. **One compression policy for all task types.** The tier ladder's thresholds are unnamed inline literals; there is no per-task-class parameterization. A locate task (short, disposable context) and a refactor task (long, identifier-heavy, quality-sensitive) compress identically.
3. **No cost model.** Compression is treated as free savings. In reality tier2 token-pruning at 0.45 ratio can force the model to re-read files (`rehydratedFiles` exists precisely because of this) and re-distill prior summaries (`PREVIOUS_SUMMARY_REDISTILL_PREFIX` in compaction-safeguard.ts) — burden shifted to the model, paid back as extra output tokens and extra turns.
4. **Quality history is recorded but never consumed.** `CompressionArtifact.quality` is persisted per compaction and surfaced over RPC, but no component aggregates it to answer "does early micro-compaction hurt refactor outcomes?". The feedback loop is open.
5. **Providers have no active budget owner.** Compatibility provider manifests carry `priority`/`order`, but there is no production registry runner or cost/value metadata that can safely trim providers under budget pressure.

### Why it matters for a personal agent platform

This is a single-developer, local-machine, educational platform. Tokens are personally paid for and context windows are the binding constraint on long sessions. The documented product rule (§8.5.3) is that "long-term truth must not depend on long chat transcripts" — but between compactions, the transcript IS the working set, and reactive-only compression means the most expensive part of every long session (the 0.75→0.95 climb) is spent in degraded emergency modes. Proactive budgeting converts that into planned, cheaper, quality-tracked compressions — and doubles as the best available teaching artifact for "how do agent runtimes manage context", which is this repo's stated purpose.

### Non-goals respected

- Quoted rule (governing this whole design, `docs/clawx-design-overview.md` §1 scope, line 25): *"automatic compaction records telemetry until evaluation gates prove the new strategy is safe to promote."* Everything below is therefore shadow-first.
- No replacement of the 5-tier model or `CompressionArtifact` v1 — both are production; this design only parameterizes and consumes them.
- No model call for task classification (deterministic heuristics only, matching `codegraph_decide` prior art).
- No Task Ledger mutation, no new RAG/vector store, no renderer-side AI logic (§1.2: "Verse Claw is not an AI engine").

## 2. Architecture Overview

```
                       ┌──────────────────────────────────────────────────────┐
                       │      [NEW] Context Budget Planning Layer             │
                       │      (shadow → pilot → active; default OFF)          │
 user prompt ────────► │                                                      │
 workspace stats ────► │  TaskClassifier ──► ContextBudgetPlanner             │
 orchestration mode ─► │   (deterministic)      │        ▲                    │
                       │                        │        │ calibration        │
                       │                 ContextBudgetPlan   CompressionCost- │
                       │                 { taskClass,        Model            │
                       │                   estimatedTurns,     ▲              │
                       │                   budgetTokens,       │ quality      │
                       │                   reserveRatio,       │ history      │
                       │                   tierSchedule,       │              │
                       │                   providerPriorities }│              │
                       └────────┬───────────────┬─────────────┼──────────────┘
                                │ (shadow: record only)       │
                 ┌──────────────▼─────┐   ┌─────▼──────────┐  │
                 │ [EXISTING] tier    │   │ [EXISTING]     │  │
                 │ selection          │   │ ContextEngine  │  │
                 │ selectCompression- │   │ .assemble(     │  │
                 │ Plan(pressure)     │   │   tokenBudget) │  │
                 │ 0.6/0.75/0.85/0.95 │   │ + provider     │  │
                 │ ◄─ tierSchedule    │   │   registry     │  │
                 │   (pilot+: earlier │   │   PILOT        │  │
                 │    soft thresholds,│   │ ◄─ provider    │  │
                 │    never later)    │   │   budgetHints  │  │
                 └────────┬───────────┘   └─────┬──────────┘  │
                          │                     │             │
                 ┌────────▼─────────────────────▼──────────┐  │
                 │ [EXISTING] planCompression → messages    │  │
                 │ [EXISTING] buildDeterministicCompression-│  │
                 │            Artifact → artifact.quality ──┼──┘ feedback loop
                 │ [EXISTING] CompactionDetails persisted   │
                 │            on compaction entry           │
                 │ [NEW, additive field] details.budgetShadow│
                 └────────┬─────────────────────────────────┘
                          │
                 ┌────────▼─────────────────────────────────┐
                 │ [EXISTING] sessions.compactionHistory /   │
                 │ sessions.compressionArtifact RPCs         │
                 │ [NEW] BudgetShadowEvaluator reads these   │
                 │ (predicted-vs-actual, simulated savings)  │
                 └───────────────────────────────────────────┘
```

Data flow: prompt + cheap stats → classification → plan. In **shadow** mode the plan flows only into the evaluator (predictions recorded next to actuals; zero behavior change). In **pilot/active** mode, two additive consumption points activate: (a) `tierSchedule` supplies per-task-class soft thresholds to the existing tier selector — which may only move thresholds EARLIER (lower), so the production ladder remains the hard backstop; (b) `providerPriorities` + provider `budgetHints` shape assemble-stage allocation. Artifact `quality` flows back into the cost model, closing the loop.

## 3. Component Specifications

All new runtime code lives under `openclaw_runtime/src/agents/context-budget/` (new directory) plus one pure-types module beside the tier selector in `openclaw_runtime/packages/agent-core/src/harness/compaction/`. No existing file is rewritten; changes to existing files are additive optional parameters/fields only (see §4).

### 3.1 TaskClassifier — `openclaw_runtime/src/agents/context-budget/task-classifier.ts` [NEW]

**Responsibility.** Classify a task from its first prompt using deterministic heuristics; no model call, no I/O beyond already-available stats. Vocabulary is the codegraph `OperationType` union plus one orchestration class:

```ts
/** Aligned with extensions/codegraph OperationType (index.ts:218) + "mission" for outer-loop runs. */
export type ContextBudgetTaskClass =
  | "answer" | "locate" | "explain" | "modify" | "debug"
  | "test" | "refactor" | "review" | "mission";

export type TaskClassificationInput = {
  prompt: string;
  /** e.g. chat | loop | mission | clawgraph-node | subagent — from the caller, not inferred. */
  orchestrationMode?: string;
  roleId?: string;
  workspaceStats?: { trackedFiles?: number; recentEditedFiles?: number };
};

export type TaskClassification = {
  taskClass: ContextBudgetTaskClass;
  /** Deterministic turn-count band per class, widened by prompt/workspace signals. */
  estimatedTurns: { min: number; expected: number; max: number };
  confidence: "high" | "medium" | "low";
  /** Which heuristics fired, for shadow diagnostics. */
  signals: string[];
};

export function classifyTask(input: TaskClassificationInput): TaskClassification;
```

**Internal state.** None — pure function (owns nothing, delegates nothing). Keyword tables mirror `codegraph_decide`'s bilingual heuristics (e.g. `refactor/重构/rename/extract` → `refactor`) so the two vocabularies cannot drift semantically; the tables are duplicated data, not a runtime dependency on the extension.

**Lifecycle.** Called once per task start (first user prompt of a session, `/loop` root, mission tick, or ClawGraph node prompt); re-called after any compaction (the projected context may change the dominant intent) and when the caller signals an explicit mode change.

**Error handling.** Cannot throw by contract: any internal failure returns `{ taskClass: "answer", estimatedTurns: {min:1, expected:4, max:10}, confidence: "low", signals: ["classifier_error_fallback"] }`.

### 3.2 Tier schedule types — `openclaw_runtime/packages/agent-core/src/harness/compaction/budget-schedule.ts` [NEW, pure types + defaults]

**Responsibility.** Name the currently-inline production thresholds and define the additive schedule shape consumed by `selectCompressionPlan`.

```ts
/** The production ladder, verified against compression-planner.ts:107-111. */
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
  tier1: 0.6,   // below: tier0 "hot-context"
  tier2: 0.75,  // below: tier1 "micro-compact"
  tier3: 0.85,  // below: tier2 "token-pruning"
  tier4: 0.95,  // below: tier3 "semantic-handoff"; at/above: tier4 "emergency-collapse"
};

export type TierThresholds = { tier1: number; tier2: number; tier3: number; tier4: number };

export type TierSchedule = {
  thresholds: TierThresholds;
  /**
   * INVARIANT enforced by normalizeTierSchedule: every scheduled threshold must be
   * <= its DEFAULT_TIER_THRESHOLDS counterpart. The planner may only compress
   * EARLIER than production, never later; the reactive ladder stays the backstop.
   */
  source: "default" | "task-class" | "operator-override";
};

export function normalizeTierSchedule(input?: Partial<TierThresholds>): TierSchedule;
```

**Flag-off parity (explicit).** When no schedule is supplied, `selectCompressionPlan` behaves byte-for-byte as today: pressure < 0.6 → `tier0`/`hot-context`, < 0.75 → `tier1`/`micro-compact`, < 0.85 → `tier2`/`token-pruning`, < 0.95 → `tier3`/`semantic-handoff`, ≥ 0.95 → `tier4`/`emergency-collapse`, with pressure still computed as `tokensBefore / (contextWindow ?? settings.contextWindow ?? reserveTokens + keepRecentTokens)`. A parity unit test asserts identical `CompressionPlan` output across boundary pressures with the parameter absent.

**Error handling.** `normalizeTierSchedule` clamps: non-finite/out-of-range values fall back to the default for that tier; a schedule that violates monotonicity (`tier1 < tier2 < tier3 < tier4`) is rejected wholesale to defaults with a warning string that flows into `CompressionTelemetry.warnings`.

### 3.3 ContextBudgetPlanner — `openclaw_runtime/src/agents/context-budget/budget-planner-shadow.ts` [NEW, shadow]

**Responsibility.** Produce a `ContextBudgetPlan` before execution and re-plan at defined checkpoints. Named `-shadow.ts` because in its first shipped form the plan is ADVISORY_ONLY: recorded, never acted on.

```ts
export type ContextBudgetPlan = {
  schemaVersion: 1;
  taskClass: ContextBudgetTaskClass;
  estimatedTurns: { min: number; expected: number; max: number };
  /** Same value the runner passes to ContextEngine.assemble({ tokenBudget }) — one budget vocabulary. */
  budgetTokens: number;
  /**
   * Extends MIN_PROMPT_BUDGET_RATIO (agent-compaction-constants.ts): fraction of budgetTokens
   * held back for output + summarization overhead. Floor: max(MIN_PROMPT_BUDGET_TOKENS,
   * CompactionSettings.reserveTokens) expressed as a ratio of budgetTokens.
   */
  reserveRatio: number;
  tierSchedule: TierSchedule;
  /** Provider ids (registry-pilot manifest ids) in trim order under pressure; lowest priority first. */
  providerPriorities: Array<{ providerId: string; valueClass: "critical" | "supporting" | "opportunistic" }>;
  /** Predicted per-turn pressure trajectory for shadow comparison. */
  predictedPressureCurve: Array<{ turn: number; pressure: number }>;
  costEstimate?: CompressionCostEstimate;
  createdAt: number;
  signals: string[];
};

export type ContextBudgetPlannerDeps = {
  classify: typeof classifyTask;
  costModel?: CompressionCostModel;      // optional: absent → default priors
  now?: () => number;
};

export function planContextBudget(input: {
  classification: TaskClassification;
  budgetTokens: number;                   // runtime-resolved, same source as assemble tokenBudget
  settings: { reserveTokens: number; keepRecentTokens: number; contextWindow?: number };
  currentTokenCount?: number;             // mirrors ContextEngineRuntimeContext.currentTokenCount
}, deps: ContextBudgetPlannerDeps): ContextBudgetPlan;
```

Default per-class schedules (initial priors, all ≤ production thresholds; calibrated later by the cost model):

| taskClass | tier1 (micro-compact) | tier2 (token-pruning) | tier3 | tier4 | rationale |
|---|---|---|---|---|---|
| answer / locate / explain | 0.6 / 0.75 / 0.85 / 0.95 (= defaults) | | | | short tasks: never pay redistillation early |
| modify / test | 0.55 | 0.72 | 0.85 | 0.95 | mild head start on tool-output-heavy work |
| debug | 0.55 | 0.70 | 0.82 | 0.95 | stack traces compress well (micro-compact targets them) |
| refactor / review | 0.50 | 0.70 | 0.82 | 0.95 | long, identifier-heavy; plan micro-compact at 0.5 instead of reacting at 0.75 |
| mission | 0.50 | 0.68 | 0.80 | 0.93 | outer loop; hand off to artifact projection early |

**Internal state.** Owns: the active plan and predicted curve for the session (in-memory, per session key). Delegates: token estimation to `estimateContextTokens` (`compaction.ts`), persistence to the compaction entry details (owned by the harness), quality history to the cost model.

**Lifecycle.** `plan` at task start → `replan` after each compaction and when observed pressure deviates from the predicted curve by > 0.15 for two consecutive turns → discarded at session end (shadow phase persists only the evaluator records, not the planner state).

**Error handling.** Isolated exactly like registry providers (`isolateRuntimeRegistryError` pattern in `provider-registry.ts`): any throw yields "no plan" — callers proceed on pure production behavior and a diagnostic is recorded. The planner can degrade a session's telemetry, never its execution.

### 3.4 CompressionCostModel — `openclaw_runtime/src/agents/context-budget/compression-cost-model.ts` [NEW]

**Responsibility.** Estimate whether compressing earlier/deeper is net-positive, calibrated from persisted artifact quality history. Reuses the existing telemetry sink — compaction entries already persist `CompactionDetails.compression` (`CompressionTelemetry`: tier, strategy, pressure, tokensBefore/After, compressionRatio, staleExcludedCount, causalAnchorCount, rehydratedFiles, warnings) and `CompactionDetails.artifact` (with `quality`), queryable via `sessions.compactionHistory` / `sessions.compressionArtifact`. **No new storage is introduced**; the model aggregates on demand from recent compaction entries and keeps a bounded in-memory cache (per pilot pattern: no schema change — the runtime's SQLite is untouched).

```ts
export type CompressionCostEstimate = {
  /** Tokens NOT re-sent over remaining predicted turns if we compress now: (tokensBefore - predictedTokensAfter) * remainingTurns. */
  savedInputTokens: number;
  /**
   * Cost of the compression itself and its aftermath: summarization call
   * (SUMMARIZATION_OVERHEAD_TOKENS vocabulary from src/agents/compaction.ts) +
   * previous-summary re-distillation + expected rehydration re-reads
   * (avg rehydratedFiles count for this class x avg file tokens from telemetry).
   */
  redistillationCost: number;
  /** P(artifact.quality.level === "low") for (taskClass, tier), from history; prior 0.15 when unseen. */
  expectedQualityRisk: number;
};

export type QualityHistorySlice = {
  taskClass: ContextBudgetTaskClass;
  tier: CompressionTier;                       // reuse from compression-planner.ts
  samples: number;
  medianQualityScore: number;                  // CompressionArtifactQuality.score
  lowLevelShare: number;                       // share with quality.level === "low"
  medianCompressionRatio?: number;             // CompressionTelemetry.compressionRatio
};

export interface CompressionCostModel {
  estimate(input: {
    taskClass: ContextBudgetTaskClass;
    tier: CompressionTier;
    tokensBefore: number;
    budgetTokens: number;
    remainingTurns: number;
  }): CompressionCostEstimate;
  /** Net benefit rule: savedInputTokens - redistillationCost - expectedQualityRisk * replanPenaltyTokens > 0. */
  isNetPositive(estimate: CompressionCostEstimate, replanPenaltyTokens?: number): boolean;
  ingestHistory(slices: QualityHistorySlice[]): void;
}
```

**Internal state.** Owns: aggregated `QualityHistorySlice` cache (bounded, LRU by taskClass×tier). Delegates: raw history retrieval to the existing session/compaction read path; never reads session `.jsonl` files itself in the renderer sense — it consumes the same in-process structures the safeguard extension already receives.

**Lifecycle.** Lazy: aggregates on first `estimate` per session; `ingestHistory` fed after each compaction completes (the freshly built artifact's `quality` is available in-process at that moment).

**Error handling.** Empty/insufficient history (< 5 samples for a slice) → documented priors (`expectedQualityRisk = 0.15`, ratio prior 0.55 ≈ observed micro-compact behavior); estimation never throws (all divisions guarded); a nonsensical estimate (negative savings) simply yields `isNetPositive() === false`, i.e. "don't compress early" — the safe direction.

### 3.5 BudgetShadowEvaluator — `openclaw_runtime/src/agents/context-budget/budget-evaluator-shadow.ts` [NEW, shadow]

**Responsibility.** The evaluation-gate machinery mandated by the line-25 rule. Records, per session: predicted vs actual pressure per turn (from `estimateContextTokens` and `ContextEngineRuntimeContext.currentTokenCount`); predicted tier firings (turn + tier) vs actual firings (from `CompressionTelemetry`); simulated savings (what the cost model claims early compression would have saved); and the observed `quality` of every real compaction.

```ts
export type BudgetShadowRecord = {
  schemaVersion: 1;
  plan: ContextBudgetPlan;
  perTurn: Array<{ turn: number; predictedPressure: number; actualPressure: number }>;
  predictedFirings: Array<{ turn: number; tier: CompressionTier }>;
  actualFirings: Array<{ turn: number; tier: CompressionTier; qualityScore?: number; qualityLevel?: string }>;
  simulatedSavedInputTokens: number;
  pressureMae: number;   // median absolute error over perTurn
};
```

**Persistence (reuse, additive):** the record is attached as a new OPTIONAL field `budgetShadow?: BudgetShadowRecord` on `CompactionDetails` (details are an untyped JSON blob on compaction entries — an additive optional key is not a schema change), and per-session rollups ride the existing diagnostics channel used by the provider-registry pilot (`RuntimeRegistryDiagnostic`-shaped, `surface: "context"`), which the observability sub-domain (§5.2) already transports. Sessions that never compact emit the rollup diagnostic only.

**Lifecycle.** Subscribes at the same extension seams the safeguard already uses (`compactionSafeguardExtension(api: ExtensionAPI)` registration style, compaction-safeguard.ts:880): after-turn for pressure sampling, compaction-complete for firing capture. Flushes at session end.

**Error handling.** Fire-and-forget; failures logged via the `createSubsystemLogger` pattern; a broken evaluator loses telemetry, never affects the run.

## 4. Integration Plan

| Existing Module (maturity) | Change Required | Rationale |
|---|---|---|
| `packages/agent-core/src/harness/compaction/compression-planner.ts` (production) | **Additive param:** `selectCompressionPlan` gains optional `thresholds?: TierThresholds`; `CompressionPlannerInput` gains optional `tierSchedule?: TierSchedule`. Absent → literals behave exactly as today (0.6/0.75/0.85/0.95). | The single point where per-task-class scheduling meets the production ladder; parameterize, don't fork. |
| `packages/agent-core/src/harness/compaction/budget-schedule.ts` (NEW) | New pure module: `DEFAULT_TIER_THRESHOLDS`, `TierSchedule`, `normalizeTierSchedule` with the ≤-defaults invariant. | Names the currently-inline thresholds once; the ≤ invariant makes "earlier only" mechanically enforced. |
| `packages/agent-core/src/harness/compaction/compaction.ts` (production, ~29 KB) | **Additive:** `CompactionSettings` gains optional `tierSchedule?: TierSchedule`; threaded into the two `planCompression` call sites (compaction.ts:792, compaction.ts:801). `CompactionDetails` gains optional `budgetShadow?`. | Settings already flow here; two optional-field additions, no control-flow change when absent. |
| `packages/agent-core/src/harness/compaction/compression-artifact.ts` (production) | **No change.** `quality` already carries score/level/fieldCoverage/evidenceCoverage/artifactTokens/projectionTokens/warnings — exactly what the feedback loop consumes. | v1 stays frozen; the cost model is a reader. |
| `packages/agent-core/src/harness/compaction/branch-summarization.ts`, `utils.ts` (production) | **No change.** | Branch summaries and file-op extraction are orthogonal to budgeting. |
| `src/agents/agent-hooks/compaction-safeguard.ts` (production, ~50 KB) | **Additive only, argued explicitly:** no edits to existing summarization/quality-guard logic. The shadow evaluator registers through the same `ExtensionAPI` seam as `compactionSafeguardExtension`; new imports live in the new `context-budget/` modules. Any wiring inside this file is limited to one optional hook registration call. At ~50 KB this file must never be rewritten — the design keeps 100% of new logic outside it. | Preserve the battle-tested quality guard; minimize blast radius in the largest compaction file. |
| `src/agents/agent-hooks/compaction-safeguard-quality.ts` (production) | **No change.** Required-sections contract untouched. | Budgeting must not weaken the summary quality contract. |
| `src/agents/agent-hooks/context-pruning/pruner.ts` + `settings.ts` (production, config-gated) | **No change.** Its `softTrimRatio 0.3` / `hardClearRatio 0.5` remain independent; the planner treats pruning as an existing pressure-relief input when predicting the curve. | Two knobs, one owner each; coupling them is a future extension, not v1. |
| `src/context-engine/types.ts` (production) | **Additive:** `ContextEngineRuntimeContext` is `Record<string, unknown> & {...}`; document a well-known optional key `contextBudgetPlan?: ContextBudgetPlan` (read-only for engines). No interface method changes; `ContextEngineHostCapability` unchanged. | Engines that care can prioritize under budget; engines that don't are untouched. Follows the existing `allowDeferredCompactionExecution` precedent for budget-ish runtime context. |
| `src/context-engine/registry.ts` (production) | **No change.** Quarantine proxy stays untouched, per constraint. | Budgeting must not alter engine failover semantics. |
| `src/context-engine/provider-registry.ts` (compatibility factories) | **No direct change without a fresh provider-runtime spec.** A future owner may add `budgetHints` to formal provider manifests only after defining a production registry consumption path and its authority boundary. | T1 deleted the unused pilot runner; this design must not recreate it as an incidental budget feature. |
| `src/context-engine/shadow-flags.ts` (shadow infra) | **Additive:** one more flag reader for `contextBudget` mode (same `runtime.*`/`agents.defaults.*` resolution style). | Reuse the existing flag plumbing instead of a new config system. |
| `src/agents/agent-compaction-constants.ts` (production) | **Additive exports only:** re-export `DEFAULT_TIER_THRESHOLDS` and add `DEFAULT_BUDGET_RESERVE_RATIO` derived from `MIN_PROMPT_BUDGET_RATIO`/`MIN_PROMPT_BUDGET_TOKENS`. Existing constants untouched. | One constants home; extend its vocabulary rather than duplicating it. |
| `src/agents/bootstrap-budget.ts` (production) | **No change.** The planner reuses its vocabulary (`nearLimitRatio` 0.85 semantics for "budget near-limit" warnings; once/always warning dedupe pattern for budget warnings). | Prior art for budget warnings; consume, don't copy. |
| `extensions/codegraph/` (production extension) | **No change.** Classifier mirrors the `OperationType` vocabulary and keyword heuristics as data. | Vocabulary alignment without a runtime dependency on an optional extension. |
| `src/gateway/methods/core-descriptors.ts` (production) | **Pilot phase only, additive:** optional read-only `sessions.contextBudget` descriptor (scope `operator.read`) returning the active plan + shadow rollup. Not needed for shadow phase. | Lets Verse Claw's Chat UI show the plan next to the existing compaction indicator (§8.5.1's UI already shows quality/score); renderer stays display-only per §1.2. |

## 5. Data Flow

End-to-end scenario: **a refactor task is classified, budgeted, runs long, hits the planned early micro-compact, and its artifact quality feeds back.** (Pilot mode shown; in shadow mode steps 5–6 are prediction-only.)

1. **Prompt arrives.** User sends "refactor the channel binding layer to remove the legacy router" to a Chat session. The embedded runner resolves the model context window — the same value it passes as `tokenBudget` to `ContextEngine.assemble` (`src/context-engine/types.ts`, assemble params).
2. **Classification.** `classifyTask` (`src/agents/context-budget/task-classifier.ts`) matches the refactor keyword family (mirroring `extensions/codegraph/index.ts:595`), sees plain-chat orchestration and a large workspace → `{ taskClass: "refactor", estimatedTurns: { min: 15, expected: 40, max: 80 }, confidence: "medium" }`.
3. **Planning.** `planContextBudget` (`budget-planner-shadow.ts`) consults the `CompressionCostModel`: history slices for (`refactor`, `tier1`) show median `quality.score` 0.78, `lowLevelShare` 0.05 → `expectedQualityRisk` low; `savedInputTokens` over ~30 remaining turns dwarfs `redistillationCost` → net-positive. Plan: `budgetTokens` = window, `reserveRatio` honoring `MIN_PROMPT_BUDGET_TOKENS`/`MIN_PROMPT_BUDGET_RATIO` and `CompactionSettings.reserveTokens` (default 16384), `tierSchedule` = refactor row (tier1 at **0.50** instead of the production-reactive 0.75), `providerPriorities` marking memory/loop-pack providers `supporting` and opportunistic retrieval `opportunistic`, plus a predicted pressure curve.
4. **Turns run.** After each turn the `BudgetShadowEvaluator` samples actual pressure via `estimateContextTokens` (`compaction.ts`) / `currentTokenCount` and appends `{ predictedPressure, actualPressure }`.
5. **Planned early firing.** At turn 19 pressure reaches 0.52. The runner's compaction path passes `settings.tierSchedule` through `prepareCompaction` → `planCompression` (compaction.ts:792). Inside, `selectCompressionPlan(..., thresholds)` now returns `{ tier: "tier1", strategy: "micro-compact", pressure: 0.52 }` — under production defaults this would still be `tier0`/`hot-context`. `planCompression` micro-compacts messages ≥ 1200 chars (stack-trace/tool-output/file-body compactors), leaving the hot tail intact. The production ladder is still armed above: if the plan mispredicts and pressure later hits 0.95, `emergency-collapse` fires exactly as today.
6. **Artifact + persistence.** `buildDeterministicCompressionArtifact` (`compression-artifact.ts`) builds the v1 artifact; `buildQuality` computes `{ score: 0.81, level: "medium", fieldCoverage, evidenceCoverage, artifactTokens, projectionTokens, warnings }`. The harness persists `CompactionDetails { readFiles, modifiedFiles, compression, artifact, budgetShadow }` — the last field being the new additive record with the plan, curve error so far, and this firing.
7. **Quality guard unchanged.** `compaction-safeguard.ts` still audits the summary against the five required sections and pending-ask/identifier preservation (`compaction-safeguard-quality.ts`); a failed audit retries per `DEFAULT_QUALITY_GUARD_MAX_RETRIES` — budgeting changed WHEN compression happened, not what quality is acceptable.
8. **Feedback.** On compaction completion the in-process artifact `quality` is fed to `CompressionCostModel.ingestHistory` for the (`refactor`, `tier1`) slice; later sessions read history through the same aggregates (backed by `sessions.compactionHistory` / `sessions.compressionArtifact`, `core-descriptors.ts:218-219`). If refactor-class early micro-compacts start trending `low`, `expectedQualityRisk` rises, `isNetPositive` flips, and the planner reverts that class toward production thresholds — a self-correcting loop.
9. **Session end.** The evaluator flushes the session rollup diagnostic (pressure MAE, predicted-vs-actual firings, simulated savings) onto the existing diagnostics/observability channel. Verse Claw may display it read-only beside the §8.5.1 compaction indicator.

## 6. Migration Path

Per the governing rule — *"automatic compaction records telemetry until evaluation gates prove the new strategy is safe to promote"* — and the repo pilot pattern.

**Operator gate.** One config knob, default off: `agents.defaults.contextBudget.mode: "off" | "shadow" | "pilot" | "active"` (resolved through the same config path as `agents.defaults.bootstrapMaxChars`; flag reader added beside `shadow-flags.ts`). Optional per-class overrides `agents.defaults.contextBudget.classes.<taskClass>.tier1..tier4`, clamped by `normalizeTierSchedule`.

**Phase 0 — off (default).** No classification, no planning, no recording. Flag-off parity: `selectCompressionPlan` receives no thresholds and reproduces 0.6/0.75/0.85/0.95 exactly; `CompactionSettings.tierSchedule` is absent; zero new fields written.

**Phase 1 — shadow (ADVISORY_ONLY).** Classifier + planner + cost model + evaluator run; `tierSchedule` and `providerPriorities` are computed but consumed by NOBODY in the execution path. Records written: `budgetShadow` on compaction entries, session rollup diagnostics. Duration: until gates below have data (≥ 20 sessions, ≥ 10 containing at least one real compression event — personal-machine scale).

**Shadow-phase telemetry** (all in the `BudgetShadowRecord`): per-turn predicted vs actual pressure; `pressureMae`; predicted firings (turn, tier) vs actual firings; simulated `savedInputTokens` minus `redistillationCost`; actual `quality.score`/`level` per firing; classifier confidence + signals.

**Promotion gates shadow → pilot** (evaluated over the shadow window, offline, by the operator):
1. **Prediction error bound:** median `pressureMae` ≤ 0.10 across sessions; classifier assigns a non-`answer` class with confidence ≥ medium in ≥ 70% of sessions where compression actually occurred.
2. **Firing prediction:** ≥ 70% of actual tier firings were predicted within ±2 turns; predicted-but-never-needed firings ≤ 20% (over-eager plans are the cost-model failure mode).
3. **Simulated net benefit:** positive simulated savings in ≥ 60% of long sessions (> 15 turns).

**Phase 2 — pilot.** `tierSchedule` becomes live at the two `planCompression` call sites. Provider `budgetHints` remain out of scope until a separate formal provider-runtime spec defines their production owner and gate. Shadow recording continues (now predicted-vs-actual-with-intervention). Promotion gates pilot → active:
1. **No quality regression:** median `CompressionArtifact.quality.score` under budgeted firings ≥ shadow-baseline median − 0.02, and `low`-level share not increased.
2. **No emergency regression:** `tier4` / `emergency-collapse` firing rate not increased vs baseline (target: strictly decreased — that is the whole point).
3. **Real net benefit:** measured total input tokens per completed long task decreased, with no increase in turns-to-completion (redistillation burden proxy).

**Phase 3 — active.** Mode `active` merely makes pilot behavior the documented default posture; the enum is retained so rollback stays one config write.

**Rollback plan (disable-only).** Set `agents.defaults.contextBudget.mode: "off"` (or any lower phase). Effects: thresholds revert instantly to the inline production literals; provider hints are ignored; planner/evaluator stop running. Already-written `budgetShadow` blobs and diagnostics are inert optional JSON — readable, never load-bearing, no cleanup or migration required. **No schema change exists to roll back**: no SQLite DDL, no `CompressionArtifact` version bump (stays `schemaVersion: 1`), no session-file format change — only optional keys inside the already-untyped `details` blob.

## 7. Design Decisions

1. **Parameterize `selectCompressionPlan`; never fork it.** Alternative rejected: a second "proactive planner" that picks tiers independently — it would create two sources of truth for the ladder and violate the "extends, does not replace" constraint. One function, one optional param, one parity test.
2. **Planned thresholds may only be ≤ production thresholds.** Alternative rejected: letting long-context models defer compression past 0.75/0.85. Deferral converts a planning bug into an emergency-collapse at 0.95 — the worst-quality tier. With the ≤ invariant, the production ladder is a formally intact backstop and the worst possible planner bug is "compressed earlier than necessary", whose cost model is exactly what §3.4 prices.
3. **Codegraph vocabulary verbatim (`modify`, not `edit`).** The direction suggested `locate | edit | refactor | review | mission`; the code says `"answer" | "locate" | "explain" | "modify" | "debug" | "test" | "refactor" | "review"` (`extensions/codegraph/index.ts:218`). Adopting the existing union verbatim (plus `mission`) keeps one task-type language across `codegraph_decide`, this planner, and any future orchestration doc. Deviation logged in the Exploration Log.
4. **Deterministic classification, no model call.** Alternative rejected: LLM-based classification at task start — it spends tokens to save tokens, adds latency to turn 1, is non-replayable for offline evaluation, and contradicts the codegraph prior art which already proves keyword heuristics suffice for routing decisions.
5. **Reuse the compaction-entry details blob + existing RPCs as the telemetry sink.** Alternatives rejected: (a) new SQLite table — schema change, forbidden by the pilot pattern; (b) new JSONL sidecar file — a second compaction history to keep consistent; (c) observability traces as primary store — traces are evidence "how a run executed", not a queryable aggregate (§8.5.3 boundary). The details blob already carries `CompressionTelemetry` + artifact; `budgetShadow` rides along and `sessions.compactionHistory` already transports it.
6. **Cost model as explicit net-benefit arithmetic, not a learned model.** Three legible numbers (`savedInputTokens`, `redistillationCost`, `expectedQualityRisk`) with documented priors keep this auditable and teachable — appropriate for an educational, single-user platform. The `quality`-history calibration gives it a feedback loop without opaque ML.
7. **Provider budget hints require a formal runtime owner.** Budget-aware trimming inside the legacy assemble path remains rejected because it would make a shadow feature authoritative through the back door. T1 removed the unused pilot runner, so any future provider-budget work needs its own spec, production consumer, authority gate, and rollback proof; the quarantine proxy (`registry.ts`) stays untouched.
8. **All new logic outside `compaction-safeguard.ts`.** At ~50 KB it is the highest-risk file in the subsystem; the design confines integration to one additive hook registration and keeps the quality contract (`compaction-safeguard-quality.ts`) frozen, so the quality-guard behavior that gates promotion is itself never perturbed by the thing being gated.
9. **Future extension points:** (a) couple the planner to cache-TTL pruning ratios (`softTrimRatio` 0.3 / `hardClearRatio` 0.5) for a unified pressure plan; (b) per-worker budgets for parallel orchestration reusing `ContextBudgetPlan` (see `02-parallel-multi-agent-orchestration.md`); (c) feed `estimatedTurns` into ClawGraph node sizing; (d) a `sessions.contextBudget` UI card in Verse Claw beside the §8.5.1 compaction indicator; (e) planner-aware `contextProjection` epochs for `thread-bootstrap-projection` hosts.

## 8. Validation Approach

**Experiments**

1. **Flag-off parity (must pass before shadow ships).** Property test over random and boundary pressures (0.0, 0.599…, 0.6, 0.749…, 0.75, 0.849…, 0.85, 0.949…, 0.95, 1.2): `selectCompressionPlan` with `thresholds` absent returns plans deep-equal to the pre-change implementation. Snapshot test on `planCompression` output for a fixture transcript.
2. **Offline replay.** Because the classifier and planner are deterministic and pure, recorded session transcripts (existing `.jsonl` session files) can be replayed through `classifyTask` + `planContextBudget` offline: verify classification stability, curve prediction against the transcript's actual token trajectory, and simulated savings — before any live shadow session runs.
3. **Threshold sweep.** Replay the corpus across candidate `tierSchedule` grids per task class; select initial priors (§3.3 table) from the sweep rather than intuition; re-run after each calibration window.
4. **Live shadow window.** ≥ 20 sessions / ≥ 10 with compression events, gathering the §6 shadow telemetry.
5. **Pilot A/B.** Alternate long sessions between `pilot` and `shadow` modes on the same workspace; compare per-completed-task: total input tokens, turns to completion, compaction count per tier, artifact quality distribution.
6. **Adversarial cases.** (a) Misclassified task (locate that becomes a refactor): assert the deviation-triggered replan fires and the production ladder still catches pressure; (b) cost-model cold start (empty history): assert priors produce default-threshold behavior for short classes; (c) planner exception injection: assert the run proceeds identically to `off` mode.

**Metrics proving success**

- Prediction: median `pressureMae` ≤ 0.10; ≥ 70% of firings predicted within ±2 turns.
- Cost: total input tokens per completed long task (> 15 turns) reduced ≥ 10% in pilot vs shadow, with turns-to-completion not increased (bounds the hidden redistillation burden).
- Quality (the artifact-integrated gate): median `quality.score` delta ≥ −0.02; `quality.level === "low"` share not increased; `missing_recovery_fields` / `low_evidence_coverage` warning rates not increased.
- Safety: `tier4` `emergency-collapse` rate strictly not increased (target: reduced); zero sessions where a planner failure blocked or altered a run in `shadow` mode.

**Metrics proving failure (triggering rollback per §6)**

- `low` quality share rises for any budgeted task class over a calibration window; or emergency-collapse rate rises; or pilot token totals exceed shadow baselines (cost model systematically over-eager). Response in every case: one config write to `mode: "off"`, then re-enter shadow with recalibrated priors.
