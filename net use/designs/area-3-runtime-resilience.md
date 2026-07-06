# 3. Runtime Resilience for Long Sessions

## Exploration Log

> FAILURE NOTE: The mandatory `codegraph_decide` and `codegraph_context_plan` calls could not be executed because CodeGraph tools/resources are not exposed in this session. I used the plan's named files, local searches, and focused source reads instead. One plan path, `src/agents/agent-hooks/compaction-safeguard.ts`, was not present; the actual file is `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`.

- CodeGraph plans executed: unavailable. Local fallback reading list covered event-log shadow flags, resume shadow, state replay, passive failure intelligence, long-conversation signals, Mission Control, compaction safeguard, and event-log pilot gates.
- Files read:
  - `openclaw_runtime/src/runtime-core/event-log.ts`: event log is schema v1 with default-off flags `eventLogShadow`, `eventLogPersist`, `checkpointSerializerShadow`, and `resumeReplayShadow`.
  - `openclaw_runtime/src/runtime-core/resume-shadow.ts`: compares event-log replay with legacy checkpoint state; legacy remains authoritative; mutating tool reuse is audited by idempotency key.
  - `openclaw_runtime/src/runtime-core/state-reducer.ts`: `replayRuntimeTaskEventLogRecords` reconstructs status, checkpoints, obligations, tool requests/results, file hashes, evidence refs, and diagnostics.
  - `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts`: `RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY = true`; classifier sanitizes signals and maps failures to stage/kind/recoverability/action.
  - `openclaw_runtime/src/agents/long-conversation-control-signals.ts`: control-signal taxonomy already covers evidence, validation, scope, permission, blocked dependency, risk, and recovery gaps with `info | warning | blocking` severity and suggested actions.
  - `openclaw_runtime/src/agents/mission-control/controller.ts`: Mission Control already gates unsafe completion, records checkpoints, maps reviewer decisions to repair/ask_user/blocked/sleep/complete, and emits observe-only Local Control Plane mission reports.
  - `openclaw_runtime/src/agents/mission-control/types.ts`: Mission status/phase/decision model and persisted record fields include control signals, validation state, acceptance status, evidence refs, and tick records.
  - `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts`: explicit pilot pattern requires fresh spec, explicit operator gate, default-off, disable-only rollback, legacy checkpoint fallback, no schema/transport/API/task-loop/provider changes, and no replay side effects.
  - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`: production compaction safeguard preserves recent turns, repairs summary quality, handles provider fallback, and bounds summary output.
  - `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts`: persisted shadow report reads SQLite event-log records, compares to latest long-task checkpoint, and recommends legacy checkpoint, event-log inspection, or waiting for verification.
  - `docs/clawx-design-overview.md`: sections 8.5.3-8.5.5 describe ResumeCheckpoint, human intervention control, Mission Control, Local Control Plane promotion rules, and non-goals.
- Existing modules found:
  - Production: `compaction-safeguard.ts`, `long-conversation-control-signals.ts`, Mission Control controller/store/types, long-task checkpoints.
  - Shadow: `event-log.ts` flags default off, `resume-shadow.ts`, `persisted-resume-shadow.ts`, `failure-intelligence-passive-shadow.ts`.
  - Pilot: `event-log-controlled-dual-read-resume-pilot.ts`, `event-log-limited-authority-cutover-pilot.ts`, destructive-operation guard preflight pilot referenced by plan/search.
  - Planned: scheduled Mission ticks are modeled but opt-in/planned in docs; Mission Control should call task_loop/ClawGraph rather than become a second runtime.
- Non-goals and constraints identified:
  - Do not create a new recovery system from scratch.
  - Legacy long-task checkpoints remain authoritative outside explicit pilot gates.
  - Replay diagnostics are not completion proof.
  - Local Control Plane observe-only reports cannot change behavior without a separate active promotion path.
  - Mission Control is not worker execution, durable ledger truth, direct memory write authority, or approval bypass.

## 1. Gap Analysis

- Existing system can detect and record resilience-relevant facts: control signals, validation state, acceptance status, failure classifications, event-log replay diagnostics, and Mission reviewer decisions.
- Existing system can recover bounded continuation context through ResumeCheckpoint and long-task checkpoints.
- Existing system can reconstruct task state from event-log records in shadow mode through `state-reducer.ts`.
- Existing Mission Control can already downgrade unsafe completion and choose repair, ask_user, blocked, sleep, or complete.
- The current gap is active supervision across those signals. Shadow classifiers observe anomalies, but no single supervisor normalizes signals, selects recovery strategy, and invokes Mission/task-loop recovery policies under explicit gates.
- Another gap is authority. Event-log replay can reconstruct state, but production authority remains legacy checkpoints; there is no controlled path for replay-assisted rollback beyond pilot diagnostics.
- This matters for a personal agent platform because long local sessions fail in ordinary ways: stale context, missing validation, repeated repairs, ambiguous tool results, provider/tool timeouts, and scope drift. A lightweight supervisor can keep a long run legible without handing over unsafe autonomous control.
- Existing non-goals respected: event-log replay will not silently become completion proof; Mission Control remains the policy loop, not a worker executor; Task Ledger remains task truth, not recovery machinery.

## 2. Architecture Overview

```text
[EXISTING] compaction-safeguard.ts
[EXISTING] long-conversation-control-signals.ts
[EXISTING] failure-intelligence-passive-shadow.ts
[EXISTING] event-log.ts / resume-shadow.ts / state-reducer.ts
[EXISTING] long-task-control/store.ts
[EXISTING] mission-control/controller.ts
        |
        v
[NEW] ActiveResilienceSupervisor
        |
        +--> [NEW] SignalNormalizer
        |
        +--> [NEW] AnomalyPatternClassifier
        |
        +--> [NEW] RecoveryStrategyRouter
        |
        +--> [NEW] ReplayRollbackPlanner
        |
        +--> [NEW] ResiliencePilotGate
        |
        v
[EXISTING] Mission decisions: continue / repair / ask_user / blocked / sleep
[EXISTING] RuntimeResumeCheckpoint + legacy long_task_checkpoints
[EXISTING] Local Control Plane reports (observe-only)
```

## 3. Component Specifications

### ActiveResilienceSupervisor

Responsibility: Coordinates resilience evaluation for a session, task loop, or Mission tick. It receives existing signals and shadow reports, classifies the current execution pattern, and returns an advisory or active recovery decision depending on pilot gates.

Interfaces:

```ts
export interface ResilienceSupervisorInput {
  sessionKey: string;
  taskId?: string;
  missionId?: string;
  runId?: string;
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  acceptanceStatus?: LongConversationAcceptanceStatus;
  failureEvents?: FailureEvent[];
  resumeShadow?: PersistedRuntimeResumeShadowReport;
  latestCheckpointId?: string;
}

export interface ResilienceSupervisorDecision {
  mode: "shadow" | "active_pilot";
  classification: "normal" | "degraded" | "anomalous" | "blocked";
  severity: "info" | "warning" | "blocking";
  action: "continue" | "repair" | "replan" | "verify" | "ask_user" | "rollback_to_checkpoint" | "block";
  reasons: string[];
  checkpointId?: string;
  replayPlanId?: string;
  missionPatch?: Partial<Pick<MissionRunRecord, "status" | "phase" | "lastDecision" | "blockedReason">>;
}
```

Internal state: Keeps no task truth. It may keep bounded in-memory dedupe state for repeated decisions, but durable state stays in Mission, checkpoints, event logs, traces, and Task Ledger.

Lifecycle: Invoked after task-loop evidence collection, before Mission reviewer completion is accepted, after failure classification, and before rollback/replan actions.

Error handling strategy: Any supervisor error degrades to `mode = "shadow"`, `action = "continue"` for non-blocking cases, or `ask_user` if the input contains blocking signals.

### SignalNormalizer

Responsibility: Converts disparate inputs into `LongConversationControlSignal[]`. It maps passive failure events, replay diagnostics, validation gaps, and Mission reviewer gaps into the existing taxonomy.

Interfaces:

```ts
export interface NormalizedSignalSet {
  signals: LongConversationControlSignal[];
  quality: LongConversationQualityAssessment[];
  blocking: boolean;
  sources: string[];
}
```

Internal state: Stateless.

Lifecycle: Runs inside supervisor evaluation.

Error handling strategy: Invalid or unknown diagnostics become warning-level `recovery_gap` with source metadata.

### AnomalyPatternClassifier

Responsibility: Classifies execution patterns as normal, degraded, anomalous, or blocked. It looks for repeated repair hashes, unresolved validation gaps, ambiguous mutating tool results, stale checkpoints, permission waits, and scope drift.

Interfaces:

```ts
export interface AnomalyPattern {
  id: string;
  classification: "normal" | "degraded" | "anomalous" | "blocked";
  severity: LongConversationControlSignalSeverity;
  matchedSignals: string[];
  confidence: number;
}
```

Internal state: Optional bounded pattern history by `sessionKey`/`missionId` to detect repeated no-progress decisions.

Lifecycle: Runs after signal normalization.

Error handling strategy: Low-confidence classifications cannot trigger active rollback; they can only recommend repair or ask_user.

### RecoveryStrategyRouter

Responsibility: Maps severity and anomaly class to recovery actions using existing semantics: info continues, warning repairs/replans/verifies, blocking asks user, blocks, or uses an explicit rollback pilot.

Interfaces:

```ts
export interface RecoveryStrategy {
  action: ResilienceSupervisorDecision["action"];
  missionDecision?: MissionDecision;
  requiresOperatorGate: boolean;
  requiresReplayParity: boolean;
  reason: string;
}
```

Internal state: Stateless policy table plus config flags.

Lifecycle: Runs for each supervisor decision and returns a strategy for Mission/task-loop callers.

Error handling strategy: If strategy prerequisites are missing, downgrade to `ask_user` or `block`, never to rollback.

### ReplayRollbackPlanner

Responsibility: Builds a rollback plan from event-log replay and legacy checkpoint state. It can propose `rollback_to_checkpoint` only when the limited-authority pilot says event-log/replay evidence is safe to consult and legacy checkpoint fallback is verified.

Interfaces:

```ts
export interface ReplayRollbackPlan {
  planId: string;
  taskId: string;
  source: "legacy_checkpoint" | "event_log_limited_authority_pilot";
  checkpointId: string;
  replayDiagnostics: string[];
  blockedBy: string[];
  executable: boolean;
}
```

Internal state: None beyond plan construction.

Lifecycle: Runs only for blocking recovery signals or explicit operator inspection.

Error handling strategy: If event-log read status is partial/unreadable, mutating tool result is ambiguous, or pilot gates are closed, plan is non-executable and recommends `inspect_event_log` or `use_legacy_checkpoint`.

### ResiliencePilotGate

Responsibility: Centralizes the existing pilot rules for active behavior. It validates explicit invocation, operator gate, default-off flag, kill switch, controlled dual-read evidence, no schema/transport/API/task-loop/provider changes, legacy fallback, and disable-only rollback. These map one-to-one onto `RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES` in `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts` (`legacy_checkpoint_fallback`, `no_schema_change`, `no_transport_change`, `no_api_or_ui_change`, `no_task_loop_change`, `no_provider_change`, `no_replay_side_effects`), and the gate's authority decision reuses the existing enum values `use_legacy_checkpoints` / `ready_for_explicit_limited_event_log_pilot` rather than inventing a new decision vocabulary.

Interfaces:

```ts
export interface ResiliencePilotGateResult {
  activeAllowed: boolean;
  selectedAuthority: "legacy_checkpoint" | "event_log_limited_authority_pilot";
  diagnostics: string[];
}
```

Internal state: Reads config/gate state only.

Lifecycle: Checked before any action beyond advisory repair/replan.

Error handling strategy: Closed or invalid gate returns `activeAllowed = false` and keeps legacy checkpoint behavior.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `openclaw_runtime/src/agents/long-conversation-control-signals.ts` | Add helper mappers from failure/replay diagnostics to existing signal kinds; no new taxonomy required. | Existing taxonomy is sufficient and shared by Mission/Task Loop. |
| `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` | No active behavior change; expose classifier output to supervisor in shadow. | It is explicitly advisory-only. |
| `openclaw_runtime/src/runtime-core/resume-shadow.ts` | No authority change; supervisor consumes diagnostics/tool reuse status. | Legacy remains authoritative. |
| `openclaw_runtime/src/runtime-core/state-reducer.ts` | No direct change. | Replay reconstruction already exists and should stay pure/no side effects. |
| `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts` | Add optional supervisor summary fields, or let supervisor consume the report as-is. | This report already bridges SQLite event logs and long-task checkpoints. |
| `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts` | Reuse as gate input for rollback/replay authority; no relaxation of required boundaries. | Pilot contract already encodes promotion rules. |
| `openclaw_runtime/src/agents/mission-control/controller.ts` | Additive hook before final reviewer decision is applied. This file is large, so the hook should call a small supervisor module rather than embedding policy. | Mission Control is the existing long-goal policy loop. |
| `openclaw_runtime/src/agents/mission-control/types.ts` | Optional metadata fields for supervisor decision id/action. | Keeps persisted Mission decisions explainable. |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` | No behavioral change; supervisor may consume compaction warning/control-signal outputs later. | Production compaction safeguard remains independent. |
| `openclaw_runtime/src/local-control-plane/index.ts` | Add observe-only `resilience` report kind only if needed, or attach to existing `mission` reports. | LCP must remain observe-only. |
| `docs/clawx-design-overview.md` | Update only if implemented later. | Architecture docs should note active supervisor remains default-off. |

## 5. Data Flow

Scenario: a Mission tick completes task_loop with missing validation and ambiguous mutating tool replay.

1. Task Loop returns evidence refs, remaining gaps, and control signals to `mission-control/controller.ts`.
2. Mission reviewer produces a decision, validation state, acceptance status, risks, and memory candidates.
3. `gateMissionReviewerCompletion` already downgrades unsafe `complete` decisions when open signals remain.
4. `ActiveResilienceSupervisor` receives Mission data, latest `PersistedRuntimeResumeShadowReport`, and passive failure events.
5. `SignalNormalizer` maps `missing_mutating_tool_result` or `ambiguous_mutating_tool_result` into blocking `recovery_gap` signals and maps validation gaps into `validation_missing`.
6. `AnomalyPatternClassifier` classifies the pattern as `blocked` if mutating tool replay is ambiguous and validation is missing.
7. `RecoveryStrategyRouter` selects `ask_user` or `block` unless `ResiliencePilotGate` confirms explicit active rollback authority.
8. If gates are closed, Mission remains legacy-checkpoint authoritative and records a checkpoint with `nextAction = ask_user` or `blocked`.
9. If gates are open and replay evidence is clean, `ReplayRollbackPlanner` proposes rollback to a specific checkpoint id. The actual rollback path still uses legacy checkpoint fallback.
10. Mission persists the decision and emits lifecycle/Local Control Plane diagnostics; no Task Ledger completion or Memory write is inferred from replay diagnostics.

## 6. Migration Path

- Shadow phase:
  - Run supervisor after Mission reviewer and task-loop failures.
  - Emit decisions as diagnostics only.
  - Compare supervisor recommendation with current Mission decision.
  - Collect false positives for repair/ask_user/block recommendations.
- Active pilot gates:
  - Fresh spec under `harness/specs/tasks/`.
  - Explicit operator gate.
  - Default-off feature flag.
  - Disable-only rollback.
  - Legacy checkpoint fallback verified.
  - No schema, transport, API/UI, task-loop, provider, or replay side-effect changes.
  - Controlled dual-read report ready and parity-clean.
- Promotion sequence:
  1. Active only for downgrading unsafe `complete` to `repair`/`ask_user`, which Mission already approximates.
  2. Active for blocking repeated no-progress repair loops.
  3. Active rollback planning, still requiring operator confirmation.
  4. Event-log limited authority only after existing pilot reports ready.
- Rollback plan:
  - Flip supervisor active flag off.
  - Ignore optional supervisor metadata.
  - Continue using `long_task_checkpoints` as authoritative source.
- Telemetry:
  - Signal counts by kind/severity, supervisor vs Mission decision agreement, rollback plans blocked by gate, ambiguous tool replay count, repeated no-progress count, and user overrides.

## 7. Design Decisions

- Decision: Promote signal interpretation before promoting replay authority. Why: signal-based repair/ask_user/block uses existing Mission semantics, while rollback changes authority and needs stricter gates.
- Alternative rejected: Make event-log replay immediately authoritative. Existing pilot files explicitly keep legacy checkpoints authoritative outside the explicit pilot.
- Decision: Use `LongConversationControlSignal` as the common anomaly language. Why: Mission, Task Loop, checkpoints, and docs already share it.
- Alternative rejected: Create a separate anomaly taxonomy. That would split recovery semantics from the long-conversation contract.
- Decision: Mission Control is the active decision host. Why: it already persists status, tick history, reviewer decisions, checkpoints, and lifecycle events.
- Alternative rejected: Put recovery decisions inside failure-intelligence shadow. That file is explicitly advisory-only and sanitized.
- Decision: Rollback planning is separable from rollback execution. Why: planning can be shadowed safely, while execution needs operator confirmation and pilot authority.
- Future extension points: scheduled Mission ticks, ClawGraph node recovery, provider-specific retry/degrade policies, and UI recovery panel actions can all consume the supervisor decision contract.

## 8. Validation Approach

- Unit tests mapping failure events and resume-shadow diagnostics into control signals.
- Classifier tests for normal, degraded, anomalous, and blocked patterns.
- Mission controller tests proving flag-off parity and active-flag downgrades only when gates allow.
- Replay rollback planner tests with clean, partial, unreadable, missing legacy, ambiguous mutating, and matched replay cases.
- Harness validation for the new active-promotion task spec.
- Shadow evaluation over recorded task-loop/Mission runs comparing supervisor decisions to current outcomes.
- Success metrics: zero flag-off behavior change, high agreement with existing Mission downgrades, no replay side effects, no completion proof derived from diagnostics, and clear operator-facing reasons for every blocking or rollback recommendation.

## 9. Round 2 Affirmed Design Strengths

The following Round 2 decisions are affirmed and must be preserved in implementation.

### 9.1 Observe-only honesty: Mission reviewer may ignore anomalyPattern

**Decision**: `classifyAnomalyPattern` output is injected into `MissionReviewerInput.anomalyPattern?` (optional field). Mission reviewer is explicitly permitted to ignore it. A3 does not assume its output influences Mission decisions.

**Why affirmed**: Honest expression of observe-only principle in simplified form. Rather than pretending A3 drives decisions, it explicitly defers to Mission Control's authority. This prevents the principal-agent duplication of the original 6-module design where a second supervisor layered over Mission Control.

**Implementation constraint**: The `anomalyPattern` field must be optional (`?`). Mission reviewer's existing decision logic must produce identical output when `anomalyPattern` is `undefined`. No A3 code path may assert that Mission consumed its output or throw if Mission ignored it.

### 9.2 Serial chain dissolution via deletion, not parallelization

**Decision**: The original 6-module serial chain (`SignalNormalizer → AnomalyPatternClassifier → RecoveryStrategyRouter → ReplayRollbackPlanner → ResiliencePilotGate → ActiveResilienceSupervisor`) is eliminated by deleting 4 modules, leaving 2 pure functions: `classifyAnomalyPattern` and `executeReplayRollback`.

**Why affirmed**: Solves the serial latency problem by removing modules rather than parallelizing them. Cleaner than redesigning for parallelism — removes the principal-agent anti-pattern entirely instead of optimizing around it. The Mission tick latency budget is preserved without complex scheduling.

**Implementation constraint**: No new serial chain may be introduced in A3. `classifyAnomalyPattern` runs as a single pure function call before Mission reviewer; `executeReplayRollback` runs only when Mission Control explicitly invokes it for a rollback decision. The two functions must not call each other.
