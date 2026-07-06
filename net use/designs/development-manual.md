# Verse Claw / ClawX — Round 2 Development Manual

This manual defines module boundaries, implementation specs, and a multi-stage development plan with concrete acceptance criteria for each stage. The guiding principle: **low coupling between modules for independent acceptance; clear boundaries on what each module can and must not do; balanced stages with complete acceptance mechanisms.**

---

## Part 1 — Module Boundary & Responsibility Matrix

### 1.1 Shared Foundation Modules

These modules are owned by no single area. They live in `shared/` or `openclaw_runtime/src/runtime-core/` and are depended on by multiple areas.

| Module | Location | CAN | MUST NOT | Read by | Written by |
|--------|----------|-----|----------|---------|------------|
| `EvidenceRef` schema | `shared/types/evidence.ts` (new) | Define the canonical evidence reference type used across all areas | Be owned by any area-specific module; be deleted when an area is deprecated | A2, A3, A4, A6 | Type contract layer only |
| `ShadowSafetyBoundary` | `shared/runtime/shadow-safety.ts` (new) | Enforce timeout, memory ceiling, exception swallowing, copy-on-read for all shadow paths | Block production paths; mutate production state; be bypassed by individual areas | All shadow paths (A1, A2, A5, A6) | Shared runtime infra |
| `ToolRegistration` (writeRiskProfile) | `shared/types/tool-registration.ts` (new) | Require static write-risk declaration at tool registration time | Accept tools without `writeRiskProfile` for write-risk actions; be modified at runtime | A1 Snapshotter, tool registry | Tool registry only |
| `ObservabilityEventNamespace` | `shared/types/observability.ts` (extended) | Define `claw.{area}.{category}.{event}` namespace structure | Allow areas to register spans outside their namespace | All areas | Observability infra |
| `LcpKindRegistry` | `openclaw_runtime/src/local-control-plane/index.ts` (extended) | Approve/reject new LCP report kinds; enforce kind count ≤ 10; require decay policy per kind | Allow self-registration by areas; exceed kind cap without project lead approval | All areas reporting to LCP | LCP module only |

### 1.2 Area-Specific Module Boundaries

#### A1 — Layered Execution Isolation

| Module | CAN | MUST NOT |
|--------|-----|----------|
| `PerTurnIsolationPolicyResolver` | Narrow workspace policy per turn; compute isolation tier from action risk | Widen workspace policy; require Main round-trip per turn; modify `SandboxEffectivePolicy` |
| `TurnIsolationCoordinator` | Begin/commit/rollback isolation leases; record touched paths | Replace ACP session lifecycle; spawn new sessions per turn; bypass `SessionActorQueue` |
| `PolicyLightSnapshotter` | Read file fingerprints from A6; perform Git-diff fallback when A6 inactive; snapshot declared write paths | Write file fingerprints; maintain its own fingerprint store; call `recordPathTouch` at runtime (replaced by static declaration) |
| `NetworkIntentGate` | Map per-turn network intent to `SandboxNetworkPolicy` | Override workspace network policy; enable network when workspace says disabled |
| `IsolationFailureRecovery` | Route cleanup through existing ACP spawn cleanup; emit `IsolationFailureRecord` | Silently continue after failed snapshot for destructive actions; create new recovery systems |

**Dependencies**: A1 reads A6 fingerprints (additive; Git-diff fallback when A6 off). A1 reads tool `writeRiskProfile` from registry. A1 does NOT depend on A2/A3/A4/A5.

#### A2 — Multi-Agent Orchestration (trimmed)

| Module | CAN | MUST NOT |
|--------|-----|----------|
| `ResourceAwareWaveScheduler` | Split waves into batches by resource constraints; defer workers on write-path/provider conflict | Choose worker identity (that's `role-router.ts`); modify waves that have started; re-plan in-flight workers |
| `ParallelRunCoordinator` | Execute scheduled batches; track in-flight workers; feed results to merge contract | Share parent session across workers; bypass `SessionActorQueue` per-worker ordering; poll child sessions (push-based only) |
| `HandoffMergeContract` | Validate handoff fields; aggregate evidence; identify conflicts; emit `ParallelMergeResult` | Mutate Task Ledger; mutate ClawGraph; enable `bounded_a2a` (deleted); spawn workers directly |

**Dependencies**: A2 reads A5 budget plan via `appliesToWave` field (A5 plan queued for next wave, current wave immutable). A2 does NOT depend on A1/A3/A4/A6 directly. Schedule diagnostics go to trace span attributes (no separate ledger).

#### A3 — Runtime Resilience (simplified to 2 pure functions)

| Module | CAN | MUST NOT |
|--------|-----|----------|
| `classifyAnomalyPattern` | Classify recent signals + session metrics into `AnomalyPattern \| null`; inject into `MissionReviewerInput.anomalyPattern?` | Produce Mission decisions; assert Mission consumed its output; call `executeReplayRollback`; maintain internal state |
| `executeReplayRollback` | Execute rollback when Mission Control explicitly invokes it with a rollback decision; check pilot gate; use legacy checkpoint fallback | Self-trigger; be called by `classifyAnomalyPattern`; bypass `ResiliencePilotGate`; promote event-log replay without pilot |

**Dependencies**: A3 injects into Mission Control reviewer input (additive optional field). A3 does NOT depend on A1/A2/A4/A5/A6. The two functions must not call each other.

#### A4 — Decision Quality (offline pure functions only)

| Module | CAN | MUST NOT |
|--------|-----|----------|
| `DecisionPointExtractor` | Convert trace spans into `DecisionPoint[]` | Run on any production turn path; require flags; register LCP kinds |
| `DecisionQualityEvaluator` | Score decision points across 6 dimensions; map evidence verifier findings | Mutate scorecard; register LCP reports; gate any runtime behavior; be called automatically |
| `DecisionQualityReport` | Aggregate per-step assessments into trace-level report | Be persisted; be used for active gating; influence Mission/Task Ledger |

**Dependencies**: A4 reads `ObservabilityTrace` and optional `EvidenceVerifierReport`. A4 is called ONLY via explicit dev-tool invocation (CLI, test fixture, debug panel). A4 does NOT depend on any other area at runtime.

#### A5 — Adaptive Context Budget

| Module | CAN | MUST NOT |
|--------|-----|----------|
| `ContextBudgetPlanner` | Divide model window into reserved slices; set pressure schedule; emit `appliesToWave` | Replace `compression-planner.ts` five-tier ladder; modify `CompressionArtifact v1`; block turns on estimation failure |
| `TaskComplexityEstimator` | Classify turn by heuristic rules (prompt shape, role, node metadata) | Use LLM pre-classifier (latency/cost); write task state; block on ambiguous classification (return `unknown`) |
| `BudgetAwareProviderRanker` | Allocate token slices across providers using manifests | Make registry authoritative; change provider ordering in active mode (shadow only); bypass `runIsolatedContextProvider` |
| `CompressionCostModel` | Estimate total work tradeoff (savings vs reasoning penalty vs retry risk) | Optimize for input tokens only; replace artifact quality scoring |
| `BudgetShadowEvaluator` | Compare shadow plans with actual outcomes; emit `BudgetShadowReport` | Make active changes; block turns; mutate compaction behavior |

**Dependencies**: A5 output (`ContextBudgetPlan`) is read by A2 scheduler (next wave only). A5 reads `compression-planner.ts` thresholds (read-only). A5 does NOT depend on A1/A3/A4/A6.

#### A6 — Long-Running Task Persistence

| Module | CAN | MUST NOT |
|--------|-----|----------|
| `SessionContinuityCoordinator` | Own pause/resume transaction boundary; take `state_leases` lease; record warm checkpoint; release lease | Execute work; own task truth; replace Mission Control; replace Task Loop; bypass `LoopContextPack` |
| `ResumeContractVerifier` | Classify state as guaranteed/reconstructable/volatile; produce `ResumeVerificationResult` | Mutate state; claim completion from replay diagnostics; bypass pilot gate for replay authority |
| `DegradationPlanner` | Turn verification mismatches into recovery route; prepare `LoopContextPackInput` | Auto-send context; auto-continue without user review on mismatch; block without actionable reason |
| `ContinuityPromotionGate` | Apply pilot pattern to event-log replay promotion; check boundaries; report `safeToPromote` | Relax required boundaries; auto-promote without evidence; bypass legacy checkpoint fallback |

**Dependencies**: A6 writes file fingerprints to `long_task_checkpoints.metadata_json` (A1 reads). A6 reads Mission Control state, Task Ledger root, ACP runtime identity. A6 does NOT depend on A2/A3/A4/A5.

### 1.3 Mission Control Modification

| Change | CAN | MUST NOT |
|--------|-----|----------|
| Add `anomalyPattern?: AnomalyPattern` to `MissionReviewerInput` | Be optional; be `undefined` in flag-off mode | Be required; change existing decision logic when `undefined`; call A3 functions internally |
| Route rollback through `executeReplayRollback` | Be called only when Mission decision action is `repair` with `repairStrategy: 'replay_rollback'` | Add `rollback` to `MissionDecision` enum (schema change blocked); self-trigger rollback without pilot gate |

---

## Part 2 — Development Stages

### Design Principles for Staging

1. **Each stage is independently shippable.** If stage N is accepted and stage N+1 is cancelled, the system is in a valid state.
2. **Each stage has concrete acceptance criteria.** "Typecheck passes" is necessary but not sufficient — behavioral assertions are required.
3. **Flag-off parity is mandatory at every stage.** No stage may change behavior when its feature flags are off.
4. **Deletions before additions.** Stages that remove complexity come before stages that add new capability.

---

### Stage 0 — Shared Foundation & Blocker Resolution

**Goal**: Establish shared types, resolve the 4 blocking contradictions, and create the infrastructure that all subsequent stages depend on.

**Scope**:

| Work Item | Deliverable |
|-----------|-------------|
| Blocker 1 resolution | Document decision: `MissionDecision` stays `repair/ask_user/blocked/sleep/complete`; rollback expressed as `repair` + `repairStrategy: 'replay_rollback'` sub-field. No enum change. |
| Blocker 2 resolution | Create `shared/types/evidence.ts` with canonical `EvidenceRef` type. Migrate A4's evidence ref type to this shared file. A2/A3/A6 import from shared. |
| Blocker 3 resolution | A3 graduation criteria decoupled from A4. Use Mission decision outcome tracking (`mission_runs` records) instead of A4 offline analysis. Document in A3 deprecation criteria. |
| Blocker 4 resolution | Document mid-turn pause protocol: pause triggers A1 lease commit (or interrupt) before A6 writes checkpoint. Add to A1+A6 test matrix. |
| `ShadowSafetyBoundary` | `shared/runtime/shadow-safety.ts` with timeout (50ms non-IO / 500ms snapshot / 2000ms network p99), 4MB buffer ceiling, exception swallowing, copy-on-read, `SHADOW_BOUNDARY_DISABLED` env var + runtime kill switch via host-api. |
| `ToolRegistration` writeRiskProfile | `shared/types/tool-registration.ts` with `WriteRiskProfile` type (`no_writes / declared_paths / pattern_writes / dynamic_writes`). |
| `ObservabilityEventNamespace` | Extend `shared/types/observability.ts` with `claw.{area}.{category}.{event}` namespace structure. |
| `LcpKindRegistry` governance | Extend LCP module with kind count cap (≤10), decay policy requirement, approval flow. |

**Acceptance Criteria**:

| # | Criterion | Verification |
|---|-----------|--------------|
| 0.1 | `shared/types/evidence.ts` compiles and exports `EvidenceRef` | `pnpm run typecheck` passes |
| 0.2 | No area-specific module owns `EvidenceRef` | `rg "interface EvidenceRef" --type ts` returns only `shared/types/evidence.ts` |
| 0.3 | `ShadowSafetyBoundary` unit tests: timeout, memory overflow, exception swallowing, copy-on-read | `pnpm test shared/runtime/shadow-safety` passes (≥10 test cases) |
| 0.4 | `ToolRegistration` rejects tools without `writeRiskProfile` for write-risk actions | Unit test: register tool with `risk: 'write'` and no `writeRiskProfile` → throws with named field error |
| 0.5 | LCP kind count cap enforced | Unit test: registering 11th kind → rejected with reason |
| 0.6 | LCP kind decay policy required | Unit test: registering kind without decay policy → rejected |
| 0.7 | Observability namespace enforced | Unit test: span with `claw.a4.invalid.event` outside A4 area → rejected |
| 0.8 | Blocker decisions documented | 4 errata entries in decision doc, each citing specific resolution |
| 0.9 | `SHADOW_BOUNDARY_DISABLED=true` skips all shadow paths | Integration test: env var set → no shadow code executes |
| 0.10 | Runtime kill switch works without restart | E2E: `hostApi.runtime.setShadowBoundary(false)` → shadow paths stop within 1 tick |
| 0.11 | Contract check passes | `pnpm contract:check` passes |
| 0.12 | Comms regression | `pnpm run comms:compare` shows no regression |

**Cannot proceed to Stage 1 until all 12 criteria pass.**

---

### Stage 1 — Deletions & Simplifications

**Goal**: Remove speculative infrastructure and collapsed modules. This stage is pure reduction — no new behavior is added. All changes are flag-off by default.

**Scope** (4 parallel work streams, no inter-dependencies):

#### Stream 1A: A4 Pilot Infrastructure Removal

| Work Item | Detail |
|-----------|--------|
| Delete `decision_quality` LCP report kind | Remove from `LOCAL_CONTROL_PLANE_REPORT_KINDS`, `KIND_TO_FLAG`, counts |
| Delete `decisionQualityReport` flag | Remove from flag registry |
| Delete `ScorecardDecisionQualityAdapter` | Remove scorecard rebalance logic, `legacyScore` dual-path |
| Delete `LocalControlPlaneDecisionQualityReporter` | Remove LCP reporting path |
| Keep: `DecisionPointExtractor`, `DecisionQualityEvaluator`, `DecisionQualityReport` | As pure functions, callable only via dev tools |
| Update A4 design doc | Remove Section 3 components that are deleted; mark as "offline analysis only" |

#### Stream 1B: A3 Module Collapse

| Work Item | Detail |
|-----------|--------|
| Delete `ActiveResilienceSupervisor` | Entire module |
| Delete `SignalNormalizer` | Entire module |
| Delete `RecoveryStrategyRouter` | Entire module |
| Implement `classifyAnomalyPattern` | Pure function in `openclaw_runtime/src/agents/anomaly-classifier.ts` |
| Implement `executeReplayRollback` (merged from `ReplayRollbackPlanner` + `ResiliencePilotGate`) | In `openclaw_runtime/src/agents/replay-rollback-authority.ts` |
| Add `anomalyPattern?: AnomalyPattern` to `MissionReviewerInput` | Optional field, additive |
| Wire `classifyAnomalyPattern` call before Mission reviewer | Shadow only (flag-gated), `undefined` when off |

#### Stream 1C: A2 Trimming

| Work Item | Detail |
|-----------|--------|
| Delete `BoundedA2AAdviceChannel` | Entire module + types |
| Delete `ConflictAndResourceLedger` | Entire module |
| Migrate scheduling diagnostics to trace span attributes | `scheduling.wave_id`, `scheduling.deferred_reason`, `resource.provider_contention` |
| Keep: `ResourceAwareWaveScheduler`, `ParallelRunCoordinator`, `HandoffMergeContract` | Three modules only |

#### Stream 1D: A6 Cold Bundle Removal

| Work Item | Detail |
|-----------|--------|
| Delete `ColdCheckpointWriter` | Entire module |
| Delete `ColdCheckpointBundle` type | Remove type definition |
| Delete `coldBundleRef` field | Remove from all references |
| Delete bundle orphan cleanup | Remove cleanup logic |
| Migrate fingerprints to `metadata_json.file_fingerprints` | Versioned JSON in existing column |
| Update `ResumeContractVerifier` | Remove cold bundle reads; read fingerprints from checkpoint metadata |

**Acceptance Criteria**:

| # | Criterion | Verification | Stream |
|---|-----------|--------------|--------|
| 1.1 | A4: no LCP `decision_quality` kind exists | `rg "decision_quality" shared/ openclaw_runtime/ src/ --type ts` returns 0 results | 1A |
| 1.2 | A4: no `decisionQualityReport` flag exists | `rg "decisionQualityReport" --type ts` returns 0 results | 1A |
| 1.3 | A4: scorecard has 5 dimensions (not 6) | Unit test: `buildTraceScorecard` returns exactly 5 items | 1A |
| 1.4 | A4: pure functions callable from dev tool | CLI: `pnpm exec tsx scripts/analyze-decision-quality.ts <trace-id>` produces report | 1A |
| 1.5 | A3: 3 deleted modules have 0 references | `rg "ActiveResilienceSupervisor\|SignalNormalizer\|RecoveryStrategyRouter" --type ts` returns 0 | 1B |
| 1.6 | A3: `classifyAnomalyPattern` is pure (no side effects) | Unit test: same input → same output; no external calls mocked | 1B |
| 1.7 | A3: `MissionReviewerInput.anomalyPattern` is optional | Typecheck: `MissionReviewerInput` without `anomalyPattern` compiles | 1B |
| 1.8 | A3: flag-off parity — Mission decisions unchanged | Golden test: 10 recorded Mission runs produce identical decisions with A3 flag off | 1B |
| 1.9 | A2: `BoundedA2AAdviceChannel` has 0 references | `rg "BoundedA2AAdviceChannel\|BoundedWorkerMessage" --type ts` returns 0 | 1C |
| 1.10 | A2: `ConflictAndResourceLedger` has 0 references | `rg "ConflictAndResourceLedger\|ResourceLedgerEvent" --type ts` returns 0 | 1C |
| 1.11 | A2: scheduling diagnostics in trace attributes | Unit test: orchestration run produces spans with `scheduling.wave_id` attribute | 1C |
| 1.12 | A6: `ColdCheckpointWriter` has 0 references | `rg "ColdCheckpointWriter\|ColdCheckpointBundle\|coldBundleRef" --type ts` returns 0 | 1D |
| 1.13 | A6: fingerprints in `metadata_json.file_fingerprints` | Integration test: pause writes fingerprints to checkpoint metadata JSON | 1D |
| 1.14 | A6: fingerprint schema versioned | Unit test: `file_fingerprints.version === 1` | 1D |
| 1.15 | All: `pnpm run typecheck` passes | — | All |
| 1.16 | All: `pnpm run lint` (no new errors) | Compare error count to baseline | All |
| 1.17 | All: `pnpm test` passes (unit) | All existing tests pass | All |
| 1.18 | All: `pnpm contract:check` passes | — | All |
| 1.19 | All: `pnpm run comms:compare` — no regression | — | All |

**Cannot proceed to Stage 2 until all 19 criteria pass.**

---

### Stage 2 — A1 Static writePaths & A6 Fingerprint Integration

**Goal**: Replace A1's runtime path tracking with static tool declarations, and wire A1 to read A6 fingerprints with Git-diff fallback.

**Scope**:

| Work Item | Detail |
|-----------|--------|
| Implement `writeRiskProfile` enforcement at tool registration | Registry rejects write-risk tools without profile |
| Migrate existing write-capable tools to declare `writePaths` | Audit all tools with `risk: 'write'` or higher; add declarations |
| Refactor `PolicyLightSnapshotter` to use declared paths | Snapshot `declaredWritePaths ∩ actual_fs_diff` |
| Implement `dynamic_writes` full fs-diff fallback | For tools that cannot declare paths |
| Wire A1 to read A6 fingerprints | Import from A6 module; use as diff baseline |
| Implement Git-diff fallback when A6 inactive | Behaviorally equivalent to today's snapshotter |
| Shadow phase: measure `actual_fs_diff - declared_paths` | Record `undeclared_write_event` when set is non-empty |

**Acceptance Criteria**:

| # | Criterion | Verification |
|---|-----------|--------------|
| 2.1 | All write-capable tools have `writeRiskProfile` | `rg "risk: 'write'" --type ts` → every match has `writeRiskProfile` in same registration |
| 2.2 | Tool registration rejects undeclared write tools | Unit test: registration throws with named field error |
| 2.3 | `dynamic_writes` tools trigger full fs-diff | Unit test: `writeRiskProfile.kind === 'dynamic_writes'` → snapshotter does full diff |
| 2.4 | A1 reads fingerprints from A6 module | `rg "getFileFingerprint" openclaw_runtime/src/agents/` → only A1 reads, only A6 writes |
| 2.5 | A1 Git-diff fallback works when A6 flag off | Unit test: A6 flag off → A1 uses Git-diff, snapshots succeed |
| 2.6 | A1 Git-diff fallback is byte-equivalent to old behavior | Golden test: same workspace, same operations → identical snapshot results |
| 2.7 | Shadow records `undeclared_write_event` | Unit test: tool writes to path not in `declaredWritePaths` → event recorded |
| 2.8 | Shadow: 0 `undeclared_write_event` when all tools declare correctly | Integration test: 10-turn session with declared tools → 0 events |
| 2.9 | A1 p99 latency ≤ 200ms (post-turn phase) | Benchmark: 100-turn session, measure p99 |
| 2.10 | A1+A6 fingerprint integration test | Integration test: A6 writes fingerprint, A1 reads it, diff is correct |
| 2.11 | Flag-off parity | Golden test: A1 flag off → workspace sandbox behaves identically to today |
| 2.12 | `pnpm run typecheck`, `pnpm test`, `pnpm contract:check` pass | — |

**Cannot proceed to Stage 3 until all 12 criteria pass.**

---

### Stage 3 — Composition, Observability & Cross-Area Tests

**Goal**: Define and enforce cross-area composition semantics, observability governance, and the 6-pair test matrix.

**Scope**:

| Work Item | Detail |
|-----------|--------|
| `area-composition-spec.md` | Decision precedence (A6>A1>A5>A3>A2>A4), shared state ownership, test matrix, resource contention rules |
| `observability_event_taxonomy.md` | Namespace structure, retention/decay policy, trace aggregation rules, LCP kind registry, scorecard governance |
| 6-pair test matrix implementation | A1+A2, A3+A6, A5+A2, A1+A6, A5+A6, A2+A6 |
| A1+A6 mid-turn pause test | (Blocker 4 resolution) Pause during A1 lease → A1 commits/interrupts → A6 writes checkpoint |
| A5 wave immutability enforcement | `ResourceAwareWaveScheduler` rejects re-plan of started waves |
| Trace span namespace enforcement | Spans outside area namespace are rejected at recording time |
| LCP kind registry: current 5 kinds audited | Confirm `context/model_router/capability/evidence/mission` have decay policies |

**Acceptance Criteria**:

| # | Criterion | Verification |
|---|-----------|--------------|
| 3.1 | `area-composition-spec.md` exists with 4 subsections | Document review: precedence, ownership, test matrix, contention |
| 3.2 | A1+A2 test: parallel workers have independent isolation scopes | E2E: 2 workers write different files → both succeed, no cross-worker isolation leak |
| 3.3 | A3+A6 test: rollback before resume | E2E: Mission rollback → `ResumeContractVerifier` marks `requires_reverification` |
| 3.4 | A5+A2 test: budget reduces workers for next wave | E2E: A5 plan reduces maxWorkers → current wave unchanged, next wave uses new count |
| 3.5 | A1+A6 test: fingerprint shared, no race | E2E: A6 writes fingerprint → A1 reads → diff correct; concurrent access test |
| 3.6 | A5+A6 test: resume re-runs budget planner | E2E: pause → resume → `ContextBudgetPlanner` re-executes, not stale |
| 3.7 | A2+A6 test: mid-checkpoint multi-worker resume | E2E: pause during multi-worker → resume creates new child sessions, does not reconnect |
| 3.8 | A1+A6 mid-turn pause test | E2E: pause during A1 lease → A1 commits lease → A6 writes checkpoint → no I/O race |
| 3.9 | A5 wave immutability: started wave not re-planned | Unit test: `ResourceAwareWaveScheduler` ignores `appliesToWave` for started wave |
| 3.10 | Trace namespace enforced | Unit test: `claw.a4.tool.choice` (wrong namespace) → rejected |
| 3.11 | LCP kind count ≤ 10 | Unit test: 11th kind rejected |
| 3.12 | LCP kind decay policy enforced | Unit test: kind without decay → rejected |
| 3.13 | Trace aggregation at >50 spans | Integration test: 60-span trace → aggregated, `claw.core.trace.truncated` emitted |
| 3.14 | `pnpm run typecheck`, `pnpm test`, `pnpm contract:check`, `pnpm run comms:compare` pass | — |

**Cannot proceed to Stage 4 until all 14 criteria pass.**

---

### Stage 4 — Governance, Performance Budgets & Pilot Preparation

**Goal**: Instrument deprecation criteria, measure performance budgets, finalize open questions, and prepare pilot gate specs for each area.

**Scope**:

| Work Item | Detail |
|-----------|--------|
| Per-area deprecation criteria instrumentation | Add telemetry counters for each area's graduation metric |
| A1 deprecation: `IsolationFailureRecovery` legacy fallback count | Counter increments on fallback invocation |
| A2 deprecation: wave deferral consistency | Counter records scheduler decision vs shadow prediction agreement |
| A3 deprecation: `anomalyPattern` non-null rate + Mission outcome | Counter records non-null rate; Mission outcome tracked via `mission_runs` |
| A5 deprecation: budget plan adoption rate | Counter records compression-planner adoption of A5 plan |
| A6 deprecation: `ResumeContractVerifier` pass rate + volatile mislabel | Counter records pass/fail; flag volatile-as-guaranteed as critical |
| Performance budget measurement | Benchmark each area's hot path against Stage 0 budgets |
| `open-questions.md` registry | 11 OQ entries with IDs, owners, blocking status |
| Per-area pilot gate spec | Fresh task spec under `harness/specs/tasks/` for each area |
| Per-turn cumulative latency budget | Define p99 ≤ 300ms cumulative; degradation order: A4→A3→A5→A1 (A2/A6 not per-turn) |
| Shadow total memory budget | Define ≤ 24MB across all shadow paths; allocate by priority |

**Acceptance Criteria**:

| # | Criterion | Verification |
|---|-----------|--------------|
| 4.1 | All 6 areas have deprecation criteria telemetry | `rg "deprecationCounter" --type ts` → 6 area modules with counters |
| 4.2 | A1 telemetry: legacy fallback count | Unit test: fallback triggers → counter increments |
| 4.3 | A2 telemetry: deferral agreement | Unit test: scheduler + shadow → agreement recorded |
| 4.4 | A6 telemetry: volatile mislabel detection | Unit test: volatile marked as guaranteed → critical counter |
| 4.5 | A1 p99 ≤ 200ms | Benchmark: 100-turn session |
| 4.6 | A2 p99 ≤ 80ms | Benchmark: 10-wave orchestration |
| 4.7 | A3 p99 ≤ 15ms | Benchmark: 100 Mission ticks |
| 4.8 | A5 p99 ≤ 30ms | Benchmark: 100-turn session |
| 4.9 | A6 p99 ≤ 300ms | Benchmark: 10 pause/resume cycles |
| 4.10 | Per-turn cumulative p99 ≤ 300ms | Benchmark: session with A1+A5+A3 active |
| 4.11 | Shadow total memory ≤ 24MB | Benchmark: all shadow paths active, measure RSS delta |
| 4.12 | `open-questions.md` has 11+ entries | Document review: each OQ has ID, area, question, assumption, owner, blocking status |
| 4.13 | 6 pilot gate task specs exist | `ls harness/specs/tasks/*-pilot.md` → 6 files |
| 4.14 | Per-area budget violation response works | Unit test per area: exceed budget → graceful degrade, no production block |
| 4.15 | `pnpm run typecheck`, `pnpm test`, `pnpm contract:check`, `pnpm run comms:compare` pass | — |

**Stage 4 is complete when all 15 criteria pass. At this point, all areas are ready for active pilot promotion (each through its own pilot gate).**

---

## Part 3 — Acceptance Mechanism Reference

### 3.1 Verification Command Reference

| Verification | Command | When |
|--------------|---------|------|
| Type check | `pnpm run typecheck` | Every stage |
| Lint (no new errors) | `pnpm run lint` | Every stage |
| Unit tests | `pnpm test` | Every stage |
| Contract check | `pnpm contract:check` | Every stage |
| Comms regression | `pnpm run comms:compare` | Every stage |
| Harness validation | `pnpm harness validate --spec <task-spec>` | Stage 4 |
| E2E | `pnpm run test:e2e` | Stages 2, 3 |
| Agent Dev fast | `pnpm agent-dev:fast` | Stages 2, 3, 4 |
| Deep test | `pnpm agent-dev:deep-test` | Stage 4 |

### 3.2 Acceptance Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| **Block** | Criterion not met → stage cannot be marked complete | Must fix before proceeding |
| **Warning** | Criterion met but borderline → review needed | Document justification and proceed |
| **Info** | Criterion met comfortably | Record and proceed |

### 3.3 Flag-Off Parity Verification

Every stage must prove that with all new feature flags off, the system behaves identically to before the stage. Verification method:

1. Record 10 representative sessions before the stage (golden fixtures).
2. After the stage, replay the same inputs with all flags off.
3. Assert: Mission decisions, Task Ledger events, trace spans (excluding new optional ones), and user-visible output are byte-identical or semantically identical (where timestamps differ).

### 3.4 Persistence Surface Checklist (Enforced at PR Review)

Any PR proposing a new persistence surface (SQLite table, file format, on-disk directory) must include answers to all 5 questions in the PR description:

1. **Byte-size estimate**: How much data per record? Per session? Total projected?
2. **Backup/restore**: How is this surface backed up? How is it restored?
3. **Migration**: What happens if the schema evolves? What is the migration path?
4. **Crash consistency**: What guarantees does the storage engine provide on crash? (SQLite WAL, atomic file rename, etc.)
5. **Retention policy**: When is data deleted? What triggers cleanup?

If any answer is "not yet defined" or missing, the PR is rejected.

### 3.5 Cross-Area Composition Test Protocol

When two areas are both being promoted to active pilot, the corresponding pair from the Stage 3 test matrix must pass before either area can be promoted. The test must cover:

1. **Expected interaction**: what should happen when both areas are active.
2. **Failure mode**: what goes wrong if composition is incorrect.
3. **Test approach**: E2E spec demonstrating the interaction.

### 3.6 Stage Sign-Off

Each stage requires sign-off from:

1. **Implementer**: confirms all acceptance criteria pass.
2. **Project lead**: confirms design intent is met and no blockers remain.
3. **Reviewer**: confirms flag-off parity, no new persistence surfaces without checklist, no observability namespace violations.

Sign-off is recorded in the stage's task spec under `harness/specs/tasks/`.

---

## Part 4 — Stage Dependency Graph

```
Stage 0 (Foundation)
    │
    ├──► Stage 1 (Deletions: A3, A4, A2, A6)  [4 parallel streams]
    │       │
    │       └──► Stage 2 (A1 writePaths + A6 fingerprint integration)
    │               │
    │               └──► Stage 3 (Composition + Observability + 6-pair tests)
    │                       │
    │                       └──► Stage 4 (Governance + Budgets + Pilot prep)
    │
    └──► [A1 writeRiskProfile migration can start in parallel with Stage 1
          once Stage 0 ToolRegistration type exists, but cannot complete
          until Stage 1D (A6 cold bundle removal) is done, because A1
          reads A6 fingerprints]
```

**Critical path**: Stage 0 → Stage 1D → Stage 2 → Stage 3 → Stage 4.

**Parallelizable**: Stage 1 streams A/B/C can proceed in parallel. Stage 1A (A4 removal) is fully independent and can start as soon as Stage 0 is complete.

---

## Part 5 — Anti-Patterns to Reject at Review

1. **"Just add a flag"** without a deprecation criteria for when the flag and its old path can be removed.
2. **"Shadow will measure it"** when a unit test could measure the same thing.
3. **"New supervisor module"** layered over Mission Control — fold capability in instead.
4. **"Runtime hook"** for an invariant that can be expressed as a static declaration at registration.
5. **"New persistence surface"** without the 5-point checklist in the PR.
6. **"New LCP kind"** without decay policy and registry approval.
7. **"New trace span"** outside the area's namespace.
8. **"Schema change"** to `MissionDecision` enum or `CompressionArtifact v1` without a separate pilot gate.
9. **"Cross-area dependency"** not listed in the composition spec's ownership table.
10. **"Active behavior"** in A4 — it is permanently diagnostic.
