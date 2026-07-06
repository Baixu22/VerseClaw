# 3. Runtime Resilience for Long Sessions

Status: architecture proposal (no code changes). Scope: the promotion path from today's shadow/advisory failure machinery to an active, operator-gated **Resilience Supervisor** for long sessions. Sibling docs: `06-session-continuity.md` (shares Gates L1/L2 below as one ladder), `01-layered-execution-isolation.md` (its fail-closed isolation events are a possible future supervisor *input*), `04-decision-quality-assessment.md` (its `decision_quality` reports are a possible future *input* signal only — mentioned as extension, not designed here).

## Exploration Log

**CodeGraph note.** This repo ships CodeGraph as a runtime extension (`openclaw_runtime/extensions/codegraph/`) whose 15 registered tools (`codegraph_decide`, `codegraph_context_plan`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_find_flow`, `codegraph_entrypoints`, `codegraph_minimal_context`, `codegraph_explore`, `codegraph_init`, `codegraph_sync`, `codegraph_status`, `codegraph_freshness`, `codegraph_git_stats` — count verified in `openclaw_runtime/extensions/codegraph/index.ts`) are registered for the runtime's own agents. They are not connected to this design session, so exploration was done directly.

**Direct-exploration equivalent (the manual "context plan"), in the priority order chosen.** (1) `long-conversation-control-signals.ts` first and in full — the signal taxonomy is the supervisor's *input contract*; every later decision keys off its exact unions. (2) The pilot exemplar `event-log-limited-authority-cutover-pilot.ts` in full — the migration path must copy its shape, so its boundary array, decision union, and gate diagnostics had to be extracted verbatim before any gate design. (3) The rollback substrate as a chain in data-flow order: `event-log.ts` (flags + record contract) → `event-log-persistence.ts` (durability) → `state-reducer.ts` (replay) → `checkpoint-serializer.ts` (snapshot payload) → `resume-shadow.ts` (comparison/tool-reuse audit) — read in this order because each consumes the previous one's types. (4) The escalation target: `mission-control/types.ts` in full, then `controller.ts` in three targeted windows (imports/deps, the reviewer-gating region, the decision→status mapping plus `pauseMission`/`resumeMission`/`cancelMission`). (5) The reuse candidates: `failure-intelligence-passive-shadow.ts` in full, `compaction-safeguard.ts` head + extension-registration region, `failure-...-destructive-operation-guard-preflight-pilot.ts` head. (6) Cross-cutting greps: `^export` per big file for identifier extraction; `long-conversation-control-signals\.js` importers (9 files — the emitter/consumer map); `state-reducer\.js` importers (3 files); `from "../runtime-core/` in `agents/` (30 hits) and `from "../agents/` in `runtime-core/` (zero hits) to establish the one-way import direction that drives component placement. (7) `docs/clawx-design-overview.md` §1.2, §8.4.1, §8.5.1, §8.5.3, §8.5.4, §8.5.5 for boundaries and non-goals.

Files read (maturity label in brackets; line cites only for lines actually read):

- `openclaw_runtime/src/agents/long-conversation-control-signals.ts` [production] — full read. Signal kinds are **nine**, not five: `evidence_gap`, `validation_missing`, `scope_drift`, `unverified_claim`, `replan_required`, `permission_wait`, `blocked_dependency`, `risk`, `recovery_gap` (lines 1–10); severities `info | warning | blocking` (line 12); suggested actions `continue | repair | replan | ask_user | block | sleep | verify` (lines 14–21). Helpers: `normalizeControlSignals` (drop-don't-throw normalization), `signalsFromGaps` (maps `repairable: false` to `blocking`/`block`), `hasBlockingControlSignal`, `defaultQualityAssessments`, `deriveValidationState`.
- `openclaw_runtime/src/runtime-core/event-log.ts` [production library; behavior flag-gated, all defaults false] — flags `eventLogShadow`, `eventLogPersist`, `checkpointSerializerShadow`, `resumeReplayShadow` at paths `runtime.eventLog.shadow`, `runtime.eventLog.persist`, `runtime.checkpointSerializer.shadow`, `runtime.resume.replayShadow`, all default `false` (lines 21–36); diagnostic-code style `RUNTIME_TASK_EVENT_LOG_DIAGNOSTIC_CODES` = `invalid_event | duplicate_idempotency_key | duplicate_event_id | store_write_failure | store_read_failure | schema_marker_mismatch` (lines 38–45); schema marker `runtime.task-event-log.v1` (line 19); `InMemoryRuntimeTaskEventLogStorage` (line 188), `RuntimeTaskEventLogStore` (line 204), `createRuntimeTaskEventLogEnvelope` (line 527), `resolveRuntimeEventLogFeatureFlags` (line 571), `runtimeEventLogFlagEnabled` (line 583).
- `openclaw_runtime/src/runtime-core/event-log-persistence.ts` [shadow: header comment says "SQLite persistence adapter for default-off RuntimeTaskEventLog shadow records", line 1] — `createRuntimeTaskEventLogSqliteStorage` (line 127), `RuntimeTaskEventLogSqliteStorage` (line 133), `createRuntimeTaskEventLogRuntimeIntegration` (line 246, already wired into `task-loop-controller.ts`), `pruneRuntimeTaskEventLogRecords` (line 304) with checkpoint-anchor-protected retention (`checkpoint_anchor_protected` skip reason, line 69).
- `openclaw_runtime/src/runtime-core/state-reducer.ts` [production pure library; consumers today: `resume-shadow.ts` (shadow), `evidence-verifier-collectors.ts`, `runtime-core/index.ts` re-export] — full read. `replayRuntimeTaskEventLogRecords(records: readonly unknown[], options?: RuntimeTaskReplayOptions): RuntimeTaskReplayResult` (line 265) delegates to `replayRuntimeTaskEvents` (line 181): a pure fold, no I/O. `RuntimeTaskReplayState` includes `latestCheckpoint`, `checkpoints`, `pendingToolCallIds`, `fileHashes`, `openObligations`, `contextSummary` (lines 66–93). Replay diagnostics: `invalid_event | invalid_event_order | duplicate_event_id | missing_checkpoint_payload | schema_marker_mismatch | terminal_event_continuation` (lines 39–46). `VALID_STATUS_TRANSITIONS` encodes the 13-status task machine (lines 123–179).
- `openclaw_runtime/src/runtime-core/resume-shadow.ts` [shadow: `legacyAuthoritative: true` hard-coded in every result, lines 89/144/159] — full read. `runRuntimeResumeShadow` (line 106) is gated on `resumeReplayShadow`; `RuntimeResumeShadowComparison { matches, fieldsCompared, mismatchedFields }` (lines 76–80); tool-reuse statuses `reused_completed | waiting_verification | ambiguous` (line 71); `isMutatingToolRequest` (line 354); diagnostic codes include `state_mismatch`, `completed_tool_result_reused`, `missing_mutating_tool_result`, `ambiguous_mutating_tool_result` (lines 20–29).
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts` [shadow: sampled via `checkpointSerializerShadow`] — full read. `serializeRuntimeCheckpoint` (line 155) / `deserializeRuntimeCheckpoint` (line 199), `RuntimeCheckpointSnapshot` (lines 71–79), `createRuntimeTaskContinueAsNewShadow` (line 101) with reasons `history_compaction | schema_upgrade | manual` (lines 45–48), schema marker `runtime.checkpoint-serializer.v1`.
- `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` [shadow: `RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY = true`, line 14] — full read. `classifyRuntimeFailurePassiveShadow` (line 75) produces a sanitized `FailureEvent` (stage/kind/recoverability, `suggestedAction: retry | degrade | continue_with_caution | ask_user | stop`, confidence 0.2–0.9, `rawRetained: false`, `redaction: "sanitized"`), with secret/path/payload redaction regexes (lines 56–73).
- `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts` [pilot; THE pattern exemplar] — full read. `RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES` = `fresh_implementation_spec, explicit_operator_gate, default_off, disable_only_rollback, legacy_checkpoint_fallback, no_schema_change, no_transport_change, no_api_or_ui_change, no_task_loop_change, no_provider_change, no_replay_side_effects` (lines 15–27); decision union `"use_legacy_checkpoints" | "ready_for_explicit_limited_event_log_pilot"` (lines 32–34) — any warning-or-error diagnostic forces the legacy decision (lines 166–168); gate diagnostics `explicit_invocation_required`, `pilot_disabled`, `operator_gate_closed`, `kill_switch_active` (lines 311–344); `rollback_proof_missing` per unproven rollback requirement (lines 403–425); diagnostics bounded with a `bounded_output` tail (lines 427–446).
- `openclaw_runtime/src/runtime-core/event-log-controlled-dual-read-resume-pilot.ts` + `event-log-resume-cutover-readiness.ts` [pilot] — targeted reads. `RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS` = `clean, partial, unreadable, corrupt_row, missing_table, missing_checkpoint, retention_pruned, mismatch, unsafe_side_effect_ambiguity`; builders `buildRuntimeEventLogControlledDualReadResumePilotReport` (line 277) and `buildRuntimeEventLogResumeCutoverReadinessReport` (line 216); dual-read ready decision `ready_for_controlled_dual_read_pilot`.
- `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts` [pilot] — first 120 lines. Prior art for describing active behavior before being allowed to perform it: `futureActiveCandidate: { action: "block", requiresAcceptedSpec: true }` (lines 20–23); fail-open allow reasons (`flag_disabled`, `candidate_missing`, …, lines 53–59); flag path `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
- `openclaw_runtime/src/agents/mission-control/types.ts` [production code, default-off per §8.5.5 `agents.defaults.missionLoop.enabled` default false] — full read. `MissionStatus` is a **nine**-value machine `idle | running | sleeping | paused | ask_user | complete | blocked | cancelled | error` (lines 11–20); `MissionPhase` (12 values, lines 22–34); `MissionDecision` = `continue | repair | sleep | ask_user | complete | blocked` (line 36); `MissionReviewerResult.controlSignals/repairBrief/validationState/acceptanceStatus` (lines 79–94); `MissionTickRecord` and `MissionLifecycleEvent` both carry `controlSignals` (lines 96–164).
- `openclaw_runtime/src/agents/mission-control/controller.ts` [production, default-off] — head + three targeted windows. Imports `recordLongTaskCheckpoint`/`getLatestLongTaskCheckpoint`/`buildRuntimeResumeCheckpoint` (lines 13–16) and the signal helpers (lines 18–25). `missionHasOpenControlSignals` uses `hasBlockingControlSignal` (lines 382–393); `missionNeedsUserConfirmation` promotes `suggestedAction` `ask_user`/`replan` and kinds `scope_drift`/`replan_required`/`permission_wait` to user confirmation (lines 395–403); `gateMissionReviewerCompletion` downgrades unsupported `complete` to `ask_user`/`repair`/`blocked` (lines 405–453); decision→status mapping at lines 1005–1034 (`ask_user` → status+phase `ask_user`, `sleep` → `sleeping`, tick budget exhaustion → `blocked`); every tick writes a checkpoint via `buildRuntimeResumeCheckpoint` + `recordLongTaskCheckpoint` with trigger `manual_review` or `guide` (lines 962–1003); `pauseMission` → `paused` (lines 1100–1109), `resumeMission` maps `paused → sleeping` (lines 1111–1120), `cancelMission` (lines 1122–1132).
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` [production, ~50 KB] — first 140 lines + extension registration region. Re-distillation machinery: `PREVIOUS_SUMMARY_REDISTILL_PREFIX` (lines 74–76), `buildPreviousSummaryMessage`/`prependPreviousSummaryForRedistill` prepend one structured `<previous-compaction-summary>` user message (lines 81–103); hook `api.on("session_before_compact", …)` (lines 880–881); quality audit in `compaction-safeguard-quality.ts` (`auditSummaryQuality`, `buildStructuredFallbackSummary`); `DEFAULT_QUALITY_GUARD_MAX_RETRIES` (line 70).
- `openclaw_runtime/src/agents/task-loop-self-check.ts` [production] — targeted read. Emits control signals with `source: "task_loop.self_check"` via `signalsFromGaps` at every parse/repair/block branch (lines 104–261); `parseTaskLoopSelfCheckResponse` (line 83); `TaskLoopSelfCheckDecision` = `complete | repair | blocked` (line 24).
- `openclaw_runtime/src/agents/long-task-control/store.ts` [production; the authoritative `long_task_checkpoints` store] — targeted read. `RuntimeResumeCheckpoint` (line 53; §8.5.4 calls the product-level contract "ResumeCheckpoint"), trigger union includes `clawgraph_node_handoff` (line 35) and `manual_review` (line 37); `recordLongTaskCheckpoint`, `getLatestLongTaskCheckpoint`, `buildRuntimeResumeCheckpoint`.
- `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts` [shadow] — import block. Existing precedent for wiring runtime-core event-log/resume-shadow modules into the agents layer.
- `openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts` [production read-only operator tooling] — `inspectRuntimeEventLogForOperator` (line 175).
- `openclaw_runtime/src/runtime-core/types.ts` — `RUNTIME_TASK_EVENT_KINDS` = the 13 task statuses + `progress`, `context`, `tool_call_request`, `tool_call_result`, `evidence`, `checkpoint`, `error` (lines 47–56). **No new event kind is needed by this design.**
- `docs/clawx-design-overview.md` — §1.2 non-goals; §8.4.1 (LCP observe-only, flags `runtime.localControlPlane.*`, envelope `openclaw.local-control-plane.report.v1`, promotion rule, explicit "no active …" non-goals); §8.5.1 (manual compaction + `CompressionArtifact v1`); §8.5.3 (stability-stack layer table; "long-term truth must not depend on long chat transcripts"; chat is "useful but disposable"); §8.5.4 (guide-first intervention; `ResumeCheckpoint` contract carries bounded `controlSignals`/`validationState`/`acceptanceStatus`; SQLite tables `long_task_checkpoints`/`long_task_intervention_events`/`long_task_user_queue`; nine checkpoint triggers); §8.5.5 (Mission lifecycle; reviewer JSON contract; completion evidence rule).

**Corrections to the brief recorded during exploration.** (1) The signal taxonomy has nine kinds, not the five listed. (2) The pilot decision value is `ready_for_explicit_limited_event_log_pilot`, not `ready_for_explicit_pilot`. (3) `MissionStatus` has nine states, not ten, and there is no explicit transition table in `controller.ts` — transitions are implicit in `tickMission`/`pauseMission`/`resumeMission`/`cancelMission`. (4) Mission Control has default-off code paths (`agents.defaults.missionLoop.enabled` default false per §8.5.5), not merely a planning note. (5) The checkpoint type in code is `RuntimeResumeCheckpoint`; "ResumeCheckpoint" is the §8.5.4 product name. (6) All brief-listed file paths existed; the pilot-spec directory is repo-root `harness/specs/tasks/` (confirmed by the two LCP spec files living there).

## 1. Gap Analysis

**What the system CAN already do.**

- *Classify*: `task-loop-self-check.ts` and `mission-control/reviewer.ts` emit typed `LongConversationControlSignal`s (nine kinds × three severities, with `suggestedAction` hints); `failure-intelligence-passive-shadow.ts` classifies raw failures into sanitized `FailureEvent`s with `recoverability` and a `suggestedAction`. Classification exists and is good — nine importers of the signal module already share one taxonomy.
- *Record*: the event log (`event-log.ts`) can capture full task history behind flags; `event-log-persistence.ts` can make it durable in SQLite with checkpoint-anchor-protected pruning; `local-control-plane/**` (§8.4.1) records observe-only reports in a bounded ring buffer.
- *Reconstruct*: `state-reducer.ts` deterministically replays `RuntimeTaskEventLogRecord`s into a `RuntimeTaskReplayState` including `latestCheckpoint` and `pendingToolCallIds`; `resume-shadow.ts` compares that replay against legacy state and audits which mutating tool results are safely reusable (`reused_completed`) versus `waiting_verification`/`ambiguous`.
- *React (narrowly)*: Mission Control converts open/blocking signals into `repair`/`ask_user`/`blocked` decisions at completion time (`gateMissionReviewerCompletion`), and `pauseMission`/`resumeMission` provide human-facing stop/continue levers. Compaction-safeguard actively repairs summary quality (`auditSummaryQuality` retry loop) — proof that a bounded in-repo "repair the next turn's input" actuator is viable.

**What the system CANNOT do — the precise gap.** Nothing closes the loop *between* those narrow points during a long session. Signals are consumed at exactly two moments — task-loop self-check (end of an inner loop) and mission reviewer (end of a tick) — and only for the *current* result. Between and across those points, repeated warnings accumulate with no density accounting, no memory that "this same `validation_missing` fired three turns in a row", and no actor mapping severity to a recovery strategy. Nothing ever calls `pauseMission` automatically. The rollback substrate (persisted log + serialized checkpoint + replay + comparison) exists entirely in shadow: `resume-shadow.ts` hard-codes `legacyAuthoritative: true`, every event-log flag defaults false, and `failure-intelligence-passive-shadow.ts` computes a `suggestedAction` that nothing reads. A blocking failure today ends as a blocked mission or a stuck chat — never as a checkpoint rollback, and never as an *automatic* escalation to `paused`/`ask_user`.

**Why the gap matters for a personal agent platform.** A single developer running overnight refactors has no ops team watching dashboards. The stability stack (§8.5.3) deliberately keeps chat "useful but disposable", but disposal is manual: the human must notice degradation and trigger handoff/fork/compaction/intervention themselves (§8.5.4 is explicitly a *human* intervention layer). A supervisor that notices *for* them — and, once trusted through its own shadow phase, repairs or rolls back — is the difference between "the mission blocked at 2am" and "the mission repaired itself twice, rolled back once, and asked one question by morning". Because this is a local, single-user, educational system, the promotion path itself (shadow → pilot → active, in the repo's own pilot grammar) is part of the learning objective.

**Non-goals respected.** §8.4.1 states the Local Control Plane MVP has "no active context pruning; no active model routing; no active evidence gating" and that "any future move from observe-only to active behavior must use a separate harness task …, add a separate active feature flag, prove flag-off parity, define rollback". This design keeps LCP observe-only forever and puts the *actor* elsewhere, under exactly that promotion rule. §8.5.5's completion rule — "an inner `task_loop` complete state or Observability trace can never upgrade a long-term goal by itself" — is preserved and extended: the supervisor can never complete anything; its strategy vocabulary contains no "complete". §8.4.1's "no durable report index, report ledger, or report-driven task truth" is respected: supervisor state is derived at runtime, never a second fact store. §1.2's "openclaw_runtime is not a UI" is preserved: no new UI surface; the operator gate is config plus explicitly invoked reports, like every existing pilot. `RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY` is never flipped: failure intelligence stays a passive classification feed forever.

## 2. Architecture Overview

```
                     SIGNAL PRODUCERS (all existing, unchanged)
  [EXISTING] task-loop-self-check.ts          [EXISTING] mission-control/reviewer.ts
     source:"task_loop.self_check"               MissionReviewerResult.controlSignals
                |                                            |
                v                                            v
        LongConversationControlSignal (kind x severity x suggestedAction)
                |                                            |
                +--------------------+-----------------------+
                                     |          [EXISTING] failure-intelligence-
                                     |           passive-shadow.ts (ADVISORY_ONLY,
                                     |           stays passive FOREVER) ---------+
                                     v                                           |
              +---------------------------------------------------+             |
              | [NEW] agents/resilience-supervisor/consumer.ts    |<-- FailureEvent
              |  per-session observer; feeds pure core; owns the  |   (correlation
              |  ONLY action wiring (L4 pilot/active)             |    feed only)
              +------------------------+--------------------------+
                                       v
              +---------------------------------------------------+
              | [NEW] runtime-core/resilience-supervisor-shadow.ts |
              |  pure FSM: normal -> degraded -> recovering ->     |
              |  normal; deterministic sliding-window rules;       |
              |  strategy table; would-have telemetry;             |
              |  diagnostic codes in event-log style               |
              +---+----------------------+----------------------+-+
                  | info: record only    | warning: repair/     | blocking: rollback
                  | (today's behavior)   | replan guidance      | OR escalate
                  v                      v                      v
   [EXISTING] event log           [EXISTING] next-turn     [EXISTING] state-reducer.ts
   progress/evidence records      injection pattern from    replayRuntimeTaskEventLog-
   (reused kinds; no schema       compaction-safeguard.ts   Records over event-log-
   change), event-log.ts +        (one structured prepended persistence.ts records ->
   event-log-persistence.ts       message; replan_required  latestCheckpoint via
   [Gate L1 substrate]            semantics honored); or    checkpoint-serializer.ts
                                  MissionReviewerResult     [Gates L2+L3]
                                  repairBrief when a               |
                                  mission is active   not safe? -> v
                                              [EXISTING] mission-control/controller.ts
                                              pauseMission -> "paused" / reviewer
                                              ask_user path -> "ask_user"; no mission:
                                              recordLongTaskCheckpoint("manual_review")
```

Data flows top-down only: producers never know the supervisor exists; the supervisor consumes, decides, and acts exclusively through existing surfaces. In shadow mode (L4 step 1) the three bottom arrows are replaced by would-have records. The [NEW] boxes are two modules plus one report builder (3.4); everything else on the diagram already exists and is not modified.

## 3. Component Specifications

### 3.1 `openclaw_runtime/src/runtime-core/resilience-supervisor-shadow.ts` [NEW — shadow, later pilot core]

**Responsibility.** Pure, deterministic evaluation: fold a bounded window of signal observations into an FSM state and a strategy decision. No I/O, no timers, no persistence, no imports from `agents/` (the observed import graph shows `runtime-core` never imports `agents`, and this module must stay usable from other runtime-core pilots and unit tests). It duplicates no classifier: inputs are already-classified `LongConversationControlSignal`-shaped observations plus optional passive `FailureEvent` annotations.

```ts
export const RUNTIME_RESILIENCE_SUPERVISOR_SCHEMA_VERSION = 1 as const;
export const RUNTIME_RESILIENCE_SUPERVISOR_SOURCE =
  "runtime.resilience_supervisor.shadow" as const;

export const RUNTIME_RESILIENCE_SUPERVISOR_DIAGNOSTIC_CODES = [
  "window_threshold_reached",
  "strategy_selected",
  "strategy_suppressed_shadow",     // would-have-acted, shadow mode
  "rollback_preconditions_unmet",   // L1/L2/L3 evidence missing -> escalate
  "replay_diagnostics_present",     // reducer reported diagnostics; rollback vetoed
  "escalation_emitted",
  "window_recovered",
  "invalid_observation",
  "bounded_output",
] as const;
export type RuntimeResilienceSupervisorDiagnosticCode =
  (typeof RUNTIME_RESILIENCE_SUPERVISOR_DIAGNOSTIC_CODES)[number];

export type RuntimeResilienceSupervisorFsmState = "normal" | "degraded" | "recovering";

export type RuntimeResilienceStrategy =
  | "record_only"         // info
  | "repair_guidance"     // warning, repairable
  | "replan_guidance"     // warning, kind scope_drift | replan_required
  | "checkpoint_rollback" // blocking, preconditions met
  | "escalate";           // blocking, preconditions unmet or rollback vetoed

export type RuntimeResilienceSignalObservation = {
  kind: LongConversationControlSignalKind;           // exact existing 9-kind union
  severity: "info" | "warning" | "blocking";
  suggestedAction?: LongConversationSuggestedAction; // exact existing 7-action union
  source?: string;                                   // e.g. "task_loop.self_check"
  observedAt: number;
  // optional correlation from the passive feed (never a trigger by itself):
  passive?: { kind: string; recoverability: string; suggestedAction: string };
};

export type RuntimeResilienceWindowRules = {
  maxObservations: number;          // default 20
  maxAgeMs: number;                 // default 30 * 60_000
  sameKindWarningThreshold: number; // default 3 -> degraded
  anyKindWarningThreshold: number;  // default 5 -> degraded
};

export type RuntimeResilienceEvaluation = {
  schemaVersion: typeof RUNTIME_RESILIENCE_SUPERVISOR_SCHEMA_VERSION;
  source: typeof RUNTIME_RESILIENCE_SUPERVISOR_SOURCE;
  fsmState: RuntimeResilienceSupervisorFsmState;
  strategy: RuntimeResilienceStrategy;
  triggerKinds: LongConversationControlSignalKind[];
  windowCounts: Record<"info" | "warning" | "blocking", number>;
  wouldHaveActed: boolean;          // true in shadow mode for any non-record_only
  diagnostics: Array<{
    code: RuntimeResilienceSupervisorDiagnosticCode;
    severity: "info" | "warning" | "error";
    message: string;
    metadata?: RuntimeCoreJsonObject;
  }>;
};

export function evaluateResilienceWindow(
  observations: readonly RuntimeResilienceSignalObservation[],
  previous: RuntimeResilienceSupervisorFsmState,
  rules?: Partial<RuntimeResilienceWindowRules>,
): RuntimeResilienceEvaluation;
```

**Deterministic FSM rules (no ML, no learned scores — every transition explainable by one diagnostic).**

- `normal → degraded`: within the window, ≥3 `warning` signals of the *same* kind, or ≥5 `warning` signals of any kind, or ≥1 `blocking` signal (fast path from any state). Emits `window_threshold_reached` with the counts in `metadata`.
- `degraded → recovering`: a strategy other than `record_only` is selected (`strategy_selected`). In shadow mode this transition is still computed — shadow telemetry exercises the whole FSM, only the acting arrows are suppressed (`strategy_suppressed_shadow`).
- `recovering → normal`: the next observation batch contains no `warning`-or-worse signal of the trigger kinds — in practice, the next self-check/reviewer result is clean or the producer reported `validationState.status === "passed"`. Emits `window_recovered`.
- `recovering → degraded`: the trigger kind repeats while recovering; the strategy escalates one step (`repair_guidance → replan_guidance → escalate`). Rollback never auto-repeats: a second blocking trigger after one rollback in the same session always maps to `escalate`.

**Strategy table** (severity selects the row; `suggestedAction` refines within a row but never overrides severity):

| Severity | Signal detail | Strategy | Acting surface |
|---|---|---|---|
| `info` | any | `record_only` | none — today's behavior, explicitly unchanged |
| `warning` | kind `scope_drift` or `replan_required`, or `suggestedAction: "replan"` | `replan_guidance` | next-turn injected brief (3.2) |
| `warning` | anything else (`validation_missing`, `evidence_gap`, `unverified_claim`, `risk`, `recovery_gap`, …) | `repair_guidance` | next-turn injected brief (3.2) |
| `blocking` | L1+L2+L3 evidence present and replay clean | `checkpoint_rollback` | replay + checkpoint restore (3.3) |
| `blocking` | otherwise; or kinds `permission_wait`/`blocked_dependency` (human-shaped by definition, mirroring `missionNeedsUserConfirmation`) | `escalate` | Mission Control `paused`/`ask_user`, or checkpoint write (3.3) |

**Internal state: owns vs delegates.** Owns nothing durable. FSM state is *derived*: the consumer re-folds the window from recorded observations on demand, so a process restart loses only an in-memory cache, never truth. Delegates classification (producers), persistence (event log), replay (`state-reducer.ts`), checkpoint payloads (`checkpoint-serializer.ts` + `long-task-control/store.ts`), and human escalation (mission controller).

**Lifecycle.** Stateless module — created never, torn down never; only `evaluateResilienceWindow` calls. **Error handling.** Malformed observations are dropped with an `invalid_observation` diagnostic (mirroring `normalizeControlSignals`'s drop-don't-throw style); diagnostics are bounded with a `bounded_output` tail exactly like the limited-authority pilot's `boundedDiagnostics` (its lines 427–446).

### 3.2 `openclaw_runtime/src/agents/resilience-supervisor/consumer.ts` [NEW — shadow, later pilot wiring]

**Responsibility.** Per-session (keyed by `sessionKey`/`taskId`) observer that (a) receives signal batches at the two existing consumption points — after task-loop self-check parse and after mission reviewer normalization — plus passive `FailureEvent`s as correlation-only annotations; (b) calls `evaluateResilienceWindow`; (c) records the evaluation; (d) in pilot/active mode only, executes the strategy through existing surfaces. Placement in `src/agents/` follows the observed precedent of `agents/long-task-control/persisted-resume-shadow.ts` — an agents-layer module wiring runtime-core shadow machinery into session flow. The placement is forced by the import graph: the signal taxonomy and the mission controller are `agents/` modules, `runtime-core` must not import them (zero such imports exist today), and the pure core (3.1) must live where other runtime-core pilots can use it. Hence the two-module split.

```ts
export type ResilienceSupervisorMode = "off" | "shadow" | "pilot" | "active";

export type ResilienceSupervisorSessionHandle = {
  observe(signals: readonly LongConversationControlSignal[], source: string): void;
  annotatePassive(event: FailureEvent): void;   // correlation only; never a trigger
  evaluationFor(taskId: string): RuntimeResilienceEvaluation | undefined;
};

export function createResilienceSupervisor(input: {
  config?: unknown;                         // resolved via resolveResilienceFlags (3.4)
  eventLogStore?: RuntimeTaskEventLogStore; // existing type, event-log.ts line 204
  missionDeps?: MissionControllerDeps;      // existing type, controller.ts line 57
  now?: () => number;
}): ResilienceSupervisorSessionHandle;
```

**Recording without schema change.** Evaluations are appended to the existing event log as `progress`-kind events (one of the existing `RUNTIME_TASK_EVENT_KINDS`, types.ts lines 47–56) with `metadata.source = "runtime.resilience_supervisor.shadow"` and the evaluation payload inside `metadata`. The envelope (`createRuntimeTaskEventLogEnvelope`) and record shape are untouched, so `no_schema_change` holds by construction, and `replayRuntimeTaskEventLogRecords` treats supervisor records as ordinary progress events (replay-neutral; validated in §8). When `eventLogPersist` is off, records live only in `InMemoryRuntimeTaskEventLogStorage`, matching today's shadow economics.

**Warning-strategy action (pilot+).** Reuses the compaction-safeguard re-distillation pattern: one structured message prepended to the next turn, exactly as `prependPreviousSummaryForRedistill` prepends `<previous-compaction-summary>` (compaction-safeguard.ts lines 81–103). The supervisor's block is `<resilience-repair-brief>`, containing the trigger kinds, the producers' own signal messages, and one bounded instruction ("verify before claiming; re-run the named checks" for `repair_guidance`; "restate the plan against the original objective before continuing" for `replan_guidance`, honoring `replan_required` semantics). Two routing rules keep existing accounting intact: when a mission is active, the brief flows through the existing reviewer repair path instead (`MissionReviewerResult.repairBrief`, decision `repair`) so `repairTicks` stays correct — the supervisor never bypasses `maxRepairTicks`; when an embedded run is active mid-turn, injection waits for the turn boundary — the supervisor never interrupts a run (that is §8.5.4's `interrupt`, a human-only lever).

**Blocking-strategy action (pilot+).** See 3.3.

**Lifecycle.** Created lazily on the first observed signal per session; evicted on session close; no timers — evaluation happens only at observation points, keeping the supervisor strictly event-driven (a design property, not a limitation: no signal, no risk, no work). **Error handling.** Any exception in observe/record paths is swallowed into a diagnostic — the supervisor must never be able to fail a turn. In pilot/active mode, an acting-path failure downgrades to `escalate`; an escalation failure downgrades to `record_only` plus an `escalation_emitted` error diagnostic. Fail toward inaction — the same "legacy behavior preserved" posture as the destructive-operation guard preflight's `action: "allow"` fallback reasons.

### 3.3 Rollback / escalation executor (inside `consumer.ts`, pilot+ only)

**Rollback preconditions (all required, checked in order; first failure short-circuits to `escalate`).**

1. Gate L1 active: persisted records exist and read back for the task (`RuntimeTaskEventLogSqliteStorage`), with no `store_read_failure` diagnostics.
2. Gate L2 active: the latest `RuntimeCheckpointSnapshot` deserializes cleanly via `deserializeRuntimeCheckpoint` (zero `RuntimeCheckpointSerializerDiagnostic`s).
3. Gate L3 active: an on-demand `replayRuntimeTaskEventLogRecords(records, { taskId })` up to the checkpoint sequence returns **zero** diagnostics — any `invalid_event_order`, `terminal_event_continuation`, `duplicate_event_id`, etc. vetoes rollback with `replay_diagnostics_present`.
4. The most recent `RuntimeResumeShadowComparison` for this task had `matches: true` (no `state_mismatch`).
5. The tool-reuse audit reports no `ambiguous` mutating results (`isMutatingToolRequest`): every mutating request's status is `reused_completed` or `waiting_verification`; `waiting_verification` entries are carried into the rebuilt context as open obligations, never silently re-executed.

If any precondition fails, the supervisor emits `rollback_preconditions_unmet` and escalates.

**Rollback semantics.** Restore-forward, not history rewrite: the log is append-only, so rollback appends a `checkpoint`-kind event referencing the restored snapshot (existing kind — no schema change), then rebuilds next-turn context from the replayed `RuntimeTaskReplayState` (`contextSummary`, `openObligations`, `latestCheckpoint`) plus the existing `RuntimeResumeCheckpoint` from `getLatestLongTaskCheckpoint`. This is §8.5.4's rule — "reconstruct context from checkpoint + Task Ledger summary + ClawGraph snapshot + Context Pack rather than asking the model to reread the full transcript" — applied automatically instead of manually. Legacy `long_task_checkpoints` remains ambient resume authority throughout (the limited-authority pilot's `legacy_checkpoint_fallback` boundary): rollback consumes the event-log path only inside this explicit request.

**Escalation semantics.** With a mission active: call `pauseMission(missionId)` (existing transition to `paused`, `phase: "schedule"`, controller.ts lines 1100–1109), or — when the trigger carries `suggestedAction: "ask_user"` or kinds `permission_wait`/`scope_drift`/`replan_required`, matching `missionNeedsUserConfirmation` — route through the reviewer path so the mission lands in `ask_user` with the trigger recorded via `recordMissionEvent` as a `MissionLifecycleEvent` (which already carries `controlSignals`). Without a mission: write a checkpoint via `recordLongTaskCheckpoint` with trigger `manual_review` (one of the nine §8.5.4 triggers) so the existing composer diagnostics and recovery-panel surfaces show it. Either way the human decides; the supervisor introduces no new user-facing surface (§1.2) and no new mission state.

### 3.4 Flags, operator gate, and shadow-telemetry report [NEW — flags + one report builder]

New flag paths mirroring the `RUNTIME_EVENT_LOG_FLAG_PATHS` style, resolved by a `resolveResilienceFlags` helper shaped like `resolveRuntimeEventLogFeatureFlags`; all default **false**:

```ts
export const RUNTIME_RESILIENCE_FLAG_PATHS = {
  supervisorShadow: "runtime.resilience.supervisorShadow",            // L4 step 1
  supervisorPilot:  "runtime.resilience.supervisorPilot",             // L4 step 2
  supervisorActive: "runtime.resilience.supervisorActive",            // L4 step 3
  resumeReplayOnDemand: "runtime.resume.replayOnDemand",              // L3
  checkpointSerializerActive: "runtime.checkpointSerializer.active",  // L2
} as const;
```

`supervisorPilot` additionally requires, per invocation, the four gate conditions from the limited-authority exemplar — explicit invocation, pilot enabled, operator gate open, kill switch inactive — evaluated by a `buildResilienceSupervisorPilotReport` whose diagnostics reuse the exact codes `explicit_invocation_required`, `pilot_disabled`, `operator_gate_closed`, `kill_switch_active`, and whose decision union is `"record_only_shadow" | "ready_for_explicit_resilience_pilot"` (same shape as `"use_legacy_checkpoints" | "ready_for_explicit_limited_event_log_pilot"`; any warning-or-error diagnostic forces the conservative decision, exactly like the exemplar's lines 166–168).

Shadow telemetry is aggregated by a `buildResilienceSupervisorShadowTelemetryReport(records)` — a pure fold over the supervisor's own `progress` records, LCP-style bounded, exposed only through the existing operator surfaces (`inspectRuntimeEventLogForOperator` for raw records; optionally mirrored as a `local_control_plane` report, which per §8.4.1 stays observe-only and cannot drive state). It computes: would-have-acted counts by strategy; the blocking false-positive estimate (fraction of would-be rollbacks in sessions that nonetheless reached a `completed` terminal status event naturally — computable purely from the same log); and per-source signal-density distributions (`task_loop.self_check` vs `mission.controller` vs reviewer) used to tune `RuntimeResilienceWindowRules` before the pilot opens.

False-positive taxonomy for this report:

- `warning_false_positive`: the supervisor would have injected
  `repair_guidance` or `replan_guidance`, but the next self-check completed
  with no matching signal and no user/repair action.
- `blocking_false_positive`: the supervisor would have selected a blocking
  strategy, but the session later reached evidence-backed completion with no
  rollback, manual correction, or repair guidance.
- `rollback_false_positive`: the supervisor would have restored a checkpoint,
  but the abandoned post-checkpoint work later proved valid through tests,
  reviewer evidence, or accepted user confirmation.
- `ambiguous`: the session was cancelled, abandoned, asked the user, exhausted
  budget, or completed without validation evidence. Ambiguous cases are counted
  but excluded from false-positive rate denominators.

The blocking false-positive numerator must require evidence-backed completion,
not merely a terminal `complete` string. Qualifying completion needs no open
blocking control signals, no required validation gaps, and either verifier/test
evidence or explicit user acceptance. This prevents the telemetry from
rewarding unsafe completion claims as if they proved the supervisor wrong.

False-positive mitigation rules:

- Shadow mode records every would-have action and performs none of them.
- Pilot mode may inject warning guidance only after repeated same-kind signals
  inside the configured window.
- Pilot rollback remains gated by L1+L2+L3 preconditions and an unambiguous
  mutating-tool reuse audit; otherwise the outcome is escalation.
- Any strategy/source pair whose false-positive rate exceeds the gate budget is
  demoted to shadow-only until `RuntimeResilienceWindowRules` are retuned and a
  fresh shadow window passes.
- Operator reports must list examples, not only aggregate rates, for the top
  false-positive sources and the top suppressed strategy/source pairs.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `openclaw_runtime/src/agents/long-conversation-control-signals.ts` [production] | **None** | Taxonomy is complete (9 kinds × 3 severities × 7 actions); the supervisor is a consumer, never a new classifier. |
| `openclaw_runtime/src/runtime-core/event-log.ts` [production, ~25 KB — any change must be additive; none is proposed] | **None** to code; Gate L1 flips existing `eventLogPersist` at runtime config | Flags, store, envelope, and diagnostic style already support everything; supervisor records reuse existing kinds. |
| `openclaw_runtime/src/runtime-core/event-log-persistence.ts` [shadow] | **None**; retention proven via existing `pruneRuntimeTaskEventLogRecords` | The L1 substrate is available behind the flag; `createRuntimeTaskEventLogRuntimeIntegration` is already called from `task-loop-controller.ts`. |
| `openclaw_runtime/src/runtime-core/state-reducer.ts` [production] | **None** | `replayRuntimeTaskEventLogRecords` is already the pure rollback reconstructor; supervisor `progress` records replay as ordinary events. |
| `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts` [shadow] | **None** | Serialize/deserialize already exist behind `checkpointSerializerShadow`; L2 adds only a flag. |
| `openclaw_runtime/src/runtime-core/resume-shadow.ts` [shadow] | **None** — stays `legacyAuthoritative: true` | Its comparison output becomes a rollback *precondition*; it never gains authority. |
| `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` [shadow] | **None — passive forever** (`RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY` never flips) | Classification feed only; the supervisor is the single actor in this design. |
| `openclaw_runtime/src/agents/task-loop-self-check.ts` [production] | Additive: one `supervisor.observe(signals, "task_loop.self_check")` call after signal normalization | Cheapest interception point; producer behavior unchanged; flag-off means the call is a no-op. |
| `openclaw_runtime/src/agents/task-loop-controller.ts` [production] | Additive: construct the session handle beside the existing `createRuntimeTaskEventLogRuntimeIntegration` call; pass through to self-check | It already owns the event-log integration point, so the supervisor rides the same wiring. |
| `openclaw_runtime/src/agents/mission-control/controller.ts` [production, ~44 KB — **additive only, never a rewrite**] | Additive: `observe(...)` after reviewer normalization; pilot+ may call existing `pauseMission` / reviewer `ask_user` path | All escalation transitions reuse functions that already exist at lines 1100–1120; no new mission states, decisions, or phases. |
| `openclaw_runtime/src/agents/mission-control/reviewer.ts` + `types.ts` [production] | **None** | `MissionReviewerResult.controlSignals` / `repairBrief` already carry everything the supervisor consumes and returns. |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` [production, ~50 KB — **no change; pattern copied, not code**] | **None** | The consumer copies the one-prepended-structured-message pattern; sharing by convention avoids coupling two safety systems' failure domains. |
| `openclaw_runtime/src/agents/long-task-control/store.ts` [production] | **None** | `recordLongTaskCheckpoint` / `getLatestLongTaskCheckpoint` already provide the escalation checkpoint write and the legacy authority. |
| `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts` [shadow] | **None** | Cited as the placement precedent only. |
| `openclaw_runtime/src/local-control-plane/**` [production, observe-only] | **None** — observe-only forever per §8.4.1 | Supervisor evaluations may be mirrored as LCP reports for debugging; LCP never acts. |
| `openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts` [production] | **None** | `inspectRuntimeEventLogForOperator` already gives the operator a read-only view of supervisor shadow records. |
| `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts` + dual-read/readiness pilots [pilot] | **None** | Reused as-is as L3 promotion evidence builders. |

## 5. Data Flow

One complete scenario: a long refactor session accumulates `validation_missing` warnings, degrades, recovers, then a blocking `evidence_gap` triggers a checkpoint rollback.

1. A long `task_loop` refactor runs with `runtime.eventLog.persist` on (Gate L1 active) and `runtime.resilience.supervisorActive` on (post-L4). Tool calls and checkpoints append to `RuntimeTaskEventLogSqliteStorage` through the existing envelope path in `event-log.ts`; `task-loop-controller.ts` constructed the supervisor session handle beside its existing event-log integration.
2. Turn 14: `task-loop-self-check.ts` finds tests not run; `signalsFromGaps({ verificationGaps, source: "task_loop.self_check" })` yields `{ kind: "validation_missing", severity: "warning", suggestedAction: "verify" }`. The consumer records the observation as a `progress` event and `evaluateResilienceWindow` returns `fsmState: "normal"` (same-kind count 1).
3. Turns 16 and 19 repeat the warning. The third same-kind warning inside the 20-observation window trips `sameKindWarningThreshold` → diagnostics `window_threshold_reached` + `strategy_selected`, `fsmState: "degraded"`, `strategy: "repair_guidance"`.
4. Next turn assembly: the consumer prepends one `<resilience-repair-brief>` message (the compaction-safeguard `prependPreviousSummaryForRedistill` pattern) naming the failing checks and instructing verification before further claims. FSM → `recovering`. No mission is active, so the reviewer path is not used and no `repairTicks` accounting applies.
5. Turn 21: self-check passes and reports `validationState.status: "passed"` → `window_recovered`, FSM → `normal`. (Had the same kind repeated instead, the strategy would have escalated one step to `replan_guidance`.)
6. Turn 30: the agent claims completion without evidence; self-check emits `{ kind: "evidence_gap", severity: "blocking", suggestedAction: "block" }` (the `repairable: false` branch of `signalsFromGaps`). Fast path: FSM → `degraded` regardless of prior state; blocking-strategy evaluation begins.
7. Preconditions run in order: persisted records read back cleanly (L1 ✓); the latest `RuntimeCheckpointSnapshot` — written at turn 26 — deserializes via `deserializeRuntimeCheckpoint` with zero diagnostics (L2 ✓); on-demand `replayRuntimeTaskEventLogRecords(records, { taskId })` up to the checkpoint sequence returns zero diagnostics (L3 ✓); the most recent `RuntimeResumeShadowComparison.matches === true` ✓; the tool-reuse audit shows every mutating result `reused_completed` ✓.
8. `strategy: "checkpoint_rollback"`. The consumer appends a `checkpoint`-kind event referencing the restored snapshot, rebuilds next-turn context from the replayed `RuntimeTaskReplayState` (`contextSummary`, `openObligations`, `latestCheckpoint`) plus `getLatestLongTaskCheckpoint()`'s `RuntimeResumeCheckpoint`, and the loop resumes from the turn-26 state with the four post-checkpoint turns abandoned — log preserved, nothing rewritten, audit trail intact.
9. Counterfactual: had replay produced any diagnostic or the comparison mismatched, the supervisor would emit `rollback_preconditions_unmet` (or `replay_diagnostics_present`) and escalate — with a mission active, `pauseMission(missionId)` → status `paused`; for `ask_user`-shaped triggers, the reviewer path → status `ask_user` recorded via `recordMissionEvent`; without a mission, `recordLongTaskCheckpoint(trigger: "manual_review")` so the §8.5.4 recovery panel and composer diagnostics surface it.
10. In `supervisorShadow` mode the identical flow stops at recording: steps 4 and 8 become `strategy_suppressed_shadow` would-have records with `wouldHaveActed: true`; nothing is injected, nothing rolls back, and `buildResilienceSupervisorShadowTelemetryReport` later folds these records into the promotion evidence for Gate L4.

## 6. Migration Path

The four gates form one strictly ordered ladder; a later gate may not open while an earlier one is closed. **Gates L1 and L2 are shared infrastructure with `06-session-continuity.md` under these exact names** — whichever design promotes first carries the evidence burden; the other consumes the already-open gate. Every gate follows the full pilot pattern from `event-log-limited-authority-cutover-pilot.ts`: a fresh spec under repo-root `harness/specs/tasks/` (the `fresh_implementation_spec` boundary; L4 additionally satisfies the preflight pilot's `requiresAcceptedSpec` prior art), an explicit operator gate, default-off flags, disable-only rollback, no schema change, and a written rollback plan.

| Gate | Flag(s) | Prerequisite | What becomes active | Rollback |
|---|---|---|---|---|
| L1 | `runtime.eventLog.persist` (existing) | `eventLogShadow` evidence | Durable event-log **writes** only | flag off; SQLite file inert |
| L2 | `runtime.checkpointSerializer.active` (new) | L1 | Snapshots designated as rollback payload | flag off; snapshots undesignated |
| L3 | `runtime.resume.replayOnDemand` (new) | L1+L2 | Replay **inside explicit rollback requests only** | flag off; blocking → `escalate` |
| L4 | `runtime.resilience.supervisorShadow` → `supervisorPilot` → `supervisorActive` (new) | shadow needs none; pilot/active acting needs L1–L3 for rollback | The supervisor itself | flag off; producers/log/replay/mission untouched |

**Gate L1 — event-log persistence: shadow → active.** Fresh spec: `harness/specs/tasks/runtime-event-log-persist-activation.md`. Evidence required before the operator opens the gate: `eventLogShadow` parity samples clean; retention proven via `pruneRuntimeTaskEventLogRecords` (including the `checkpoint_anchor_protected` floor); `store_write_failure`/`store_read_failure` diagnostic rates ≈ 0 over the shadow corpus; `inspectRuntimeEventLogForOperator` shows expected sequences on real sessions. Activation changes *writes only* — nothing reads the log for behavior yet. Rollback plan: set the flag false; writes stop; the SQLite table becomes inert history; legacy `long_task_checkpoints` was never displaced. No schema change: marker stays `runtime.task-event-log.v1` at version 1.

**Gate L2 — checkpoint serialization: shadow → active checkpoints.** Fresh spec: `harness/specs/tasks/runtime-checkpoint-serializer-activation.md`. Flags: existing `runtime.checkpointSerializer.shadow` stays on through the evidence phase; new `runtime.checkpointSerializer.active` (default false) designates snapshots as the supervisor's rollback payload. Evidence: serialize→deserialize round-trips clean across the shadow corpus (zero `RuntimeCheckpointSerializerDiagnostic`s); snapshots embedded in replay reconstruct `latestCheckpoint` correctly. "Active" never contradicts `legacyCheckpointsDefaultAuthoritative: true` — legacy checkpoints remain ambient resume authority. Rollback plan: flag off; snapshots stop being designated; nothing else changes.

**Gate L3 — resume/replay: shadow → active-on-demand (rollback path only, never ambient resume).** Fresh spec: `harness/specs/tasks/runtime-resume-replay-on-demand.md`. Flags: existing `runtime.resume.replayShadow` on; new `runtime.resume.replayOnDemand` (default false). Evidence reuses the existing pilot machinery instead of duplicating it: `buildRuntimeEventLogResumeCutoverReadinessReport` for scenario coverage across all nine `RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS` (`clean` … `unsafe_side_effect_ambiguity`); `buildRuntimeEventLogControlledDualReadResumePilotReport` reaching `ready_for_controlled_dual_read_pilot`; then `buildRuntimeEventLogLimitedAuthorityCutoverPilotReport` reaching `ready_for_explicit_limited_event_log_pilot` with all 11 `RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES` clear. "On-demand" is the sharpest constraint: replay may execute only inside an explicit supervisor rollback request; ordinary session resume continues from `long_task_checkpoints` untouched (`legacy_checkpoint_fallback`, `no_task_loop_change`). Rollback plan: flag off; the blocking strategy degrades to `escalate` everywhere; nothing else changes.

**Gate L4 — the supervisor: shadow → pilot → active.** Fresh spec: `harness/specs/tasks/resilience-supervisor-pilot.md` (written at implementation time; satisfies `fresh_implementation_spec` and the preflight pilot's `requiresAcceptedSpec`). *Step 1, shadow*: `runtime.resilience.supervisorShadow` on; records would-have decisions only; L1 recommended for durable windows (in-memory acceptable for early sampling). *Step 2, pilot*: `runtime.resilience.supervisorPilot` plus the per-invocation gates (`explicit_invocation_required`, `pilot_disabled`, `operator_gate_closed`, `kill_switch_active`); warning strategies act; the blocking strategy acts only if L1+L2+L3 are open, else it escalates. *Step 3, active*: `runtime.resilience.supervisorActive`; same behavior without per-invocation explicitness; the kill switch is retained permanently. Promotion evidence comes from the shadow telemetry (3.4): would-have `repair_guidance` precision ≥ 70% (the trigger kind genuinely persisted into the next check when nothing was injected), blocking false-positive estimate ≤ 5%, zero supervisor-attributed turn failures. Rollback plan at every step: disable the one flag — producers, event log, replay, and mission control continue exactly as today because none of them was modified (disable-only rollback); `no_schema_change` holds since only existing event kinds were reused; supervisor FSM state is derived, so there is nothing to migrate or delete.

Gate L4 also requires a false-positive review packet before promotion. The
packet must include representative would-have actions, their source signals,
later evidence, the classification (`confirmed`, `false_positive`, or
`ambiguous`), and the rule change or suppression decision for every repeated
false-positive source. Aggregate rates without examples are insufficient.

**failure-intelligence-passive-shadow has no gate — deliberately.** It stays `ADVISORY_ONLY` forever: it is the classification feed; the supervisor is the only actor.

## 7. Design Decisions

1. **Consumer, not classifier.** The supervisor never inspects raw failures or transcripts; it folds already-typed signals. *Rejected*: a new anomaly classifier — it would duplicate `failure-intelligence-passive-shadow.ts` and `task-loop-self-check.ts` and violate the "extend, don't parallel" constraint.
2. **Two-module split: pure core in `runtime-core/`, wiring in `agents/`.** Forced by the observed import direction (`agents/*` → `runtime-core/*` in 30 import sites; the reverse: zero). Precedent: `agents/long-task-control/persisted-resume-shadow.ts`. *Rejected*: single module in `agents/` (the pure FSM becomes unusable from runtime-core pilots and breaks the convention that shadow/pilot cores live in `runtime-core/`); single module in `runtime-core/` (cannot import the signal types or the mission controller without creating the first-ever upward import).
3. **Derived FSM state, no new persistence.** State is a pure fold over recorded observations; supervisor records reuse the `progress`/`checkpoint` event kinds. *Rejected*: a supervisor table or SQLite store — violates `no_schema_change` and creates a second fact system, the exact failure §8.4.1 forbids ("no durable report index, report ledger, or report-driven task truth").
4. **Deterministic sliding-window thresholds, no ML.** Three integers an operator can read, predict, and tune; every transition maps to one diagnostic code. *Rejected*: learned scoring — untestable rollback story, opaque for an educational codebase, and unfalsifiable shadow telemetry.
5. **Rollback is restore-forward on an append-only log.** A rollback appends; it never truncates. *Rejected*: truncating history to the checkpoint — destroys the audit trail, breaks replay determinism, and violates the `no_replay_side_effects` boundary.
6. **Escalate on any rollback doubt** (replay diagnostics, comparison mismatch, ambiguous mutating tool result). Matches §8.5.4's guide-first, human-in-the-loop posture and the mission rule that evidence gaps become `repair`/`blocked`/`ask_user`. *Rejected*: auto-retry loops — mission control's `noProgressHash` machinery exists precisely because blind retries mask degradation.
7. **Failure intelligence stays passive forever.** Its `FailureEvent`s annotate observations for telemetry correlation only (`annotatePassive`). *Rejected*: promoting it to a trigger source — two actors and two trigger taxonomies; this design keeps exactly one actor and one trigger taxonomy.
8. **Mission integration reuses existing transitions only** (`pauseMission`, the reviewer `ask_user` path, `repairBrief`). *Rejected*: new mission states or a supervisor-owned decision kind — the nine `MissionStatus` values and six `MissionDecision` values already express every outcome the supervisor needs, and §8.5.5's evidence-gated completion must remain the only completion authority.
9. **Warning actions ride the next turn boundary, never an active run.** Mid-run intervention remains human-only (§8.5.4 `interrupt`/`guide`). *Rejected*: supervisor-driven mid-run steering via the embedded-agent queue — it blurs the human-intervention layer's ownership and complicates attribution of turn failures during the pilot.
10. **Future extension points (left open, not designed).** `04-decision-quality-assessment.md` `decision_quality` reports and `01-layered-execution-isolation.md` fail-closed isolation events as additional *observation* inputs (never new actors); per-workspace `RuntimeResilienceWindowRules` overrides once shadow distributions justify them; ClawGraph node-level supervision consuming the `clawgraph_node_handoff` checkpoint trigger; surfacing supervisor state in the §8.5.4 recovery panel (a UI change, hence out of scope here per §1.2).

## 8. Validation Approach

**Unit (pure core).** Property tests on `evaluateResilienceWindow`: identical observation sequences produce identical evaluations (determinism); threshold boundary cases (2 vs 3 same-kind warnings; 4 vs 5 any-kind); the blocking fast path from every FSM state; escalation ordering `repair_guidance → replan_guidance → escalate`; rollback-never-repeats; diagnostics bounded with `bounded_output`. Golden-table tests covering the full strategy matrix: 9 kinds × 3 severities × 7 suggested actions (189 cases, generated).

**Replay-integration.** Build a synthetic log on the existing `InMemoryRuntimeTaskEventLogStorage`, interleave supervisor `progress` records with real task events, and assert `replayRuntimeTaskEventLogRecords` yields zero diagnostics and an unchanged final `RuntimeTaskStatus` — proving supervisor records are replay-neutral (`no_replay_side_effects` by test, not by claim). Rollback fixture: a log with a checkpoint at sequence *k* and a corrupted event at *k+3*; assert precondition 3 vetoes with `replay_diagnostics_present` and the escalate path is taken. Tool-safety fixture: a mutating request without an idempotency key; assert the `ambiguous` audit status blocks rollback (precondition 5).

**Flag-off parity (the §8.4.1 promotion rule's core check).** With all five resilience/L-gate flags false, run the existing task-loop and mission suites; assert zero behavioral diffs and zero new records. Repeat with only `supervisorShadow` on; assert prompt text, tool calls, mission statuses, and checkpoints are byte-identical while would-have records appear. This parity check re-runs at every gate before it opens.

**Run-through compatibility.** If the runtime, docs, and shadow/pilot design
disagree, the default repair is documentation drift capture plus conservative
fallback behavior, not a broad runtime rewrite. A supervisor gate may not open
because a diagram says it should; it opens only after the current stitched
runtime still completes the ordinary Task Loop / Mission / Chat flows with the
new flag disabled. Any discovered mismatch becomes a compatibility note, a
targeted follow-up spec, or a degraded-mode rule before it becomes code churn.

**Shadow experiment (pre-L4-pilot, on the developer's own workload).** ≥2 weeks of real long sessions with `supervisorShadow` + L1 on. Success metrics: (a) blocking false-positive estimate ≤ 5% using only evidence-backed completions as positives for "the supervisor was wrong"; (b) `repair_guidance` precision ≥ 70% (the trigger kind persisted into the next self-check when no guidance was injected — i.e., the warning was real); (c) zero supervisor-attributed errors in turn execution; (d) window-rule sensitivity: per-source signal densities separate degraded from normal sessions with a visible margin; (e) a false-positive packet containing at least three reviewed would-have actions or all observed false-positive candidates if fewer than three exist. If a source/strategy pair dominates false positives, `RuntimeResilienceWindowRules` are retuned *in shadow* and the clock restarts. Failure criteria: any turn failure attributable to observation/recording, a false-positive estimate > 15% after tuning, or missing example review for false-positive candidates → the design stays in shadow and the pilot gate does not open.

**Pilot experiment (L4 step 2).** Explicit invocation on selected long refactor sessions. Metrics: repaired-without-human rate vs matched shadow-only sessions; rollback count with post-rollback completion rate; time-to-human for escalations vs the baseline "mission blocked at budget exhaustion"; `repairTicks` accounting correctness when briefs route through the mission reviewer. Every pilot session ends with a live disable check: flag off mid-session → the session continues on legacy behavior with no residue (disable-only rollback proven live — this design's equivalent of the exemplar's `legacy_checkpoint_fallback` proof).

**Success definition.** The supervisor is "working" when shadow telemetry predicts its pilot behavior (would-have decisions match pilot decisions on comparable sessions), recovery actions shorten degraded episodes without inflating turn counts, and disabling any single flag returns the runtime to byte-identical legacy behavior. Failure at any gate is cheap by construction: close the flag, keep the telemetry, retune, retry.
