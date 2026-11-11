---
lifecycleStatus: active
id: execution-phase-commit
title: Execution Phase State Machine and CAS Commit (TF-0717)
taskType: engineering-acceptance
diffBase: 99c142fef431fcc92a1a37f47aa1002f897f0b64
intent: Make the execution phase a first-class, CAS-committed part of the TaskFlow lifecycle owner so a restarted process can decide whether re-entry is safe, needs reconciliation, or is forbidden. Default writer stays legacy; taskflow runs only behind an explicit gate; the runtime event log stays default off.
ownedPaths:
  - shared/recovery-contract/execution-phase.ts
  - tests/unit/recovery-contract-execution-phase.test.ts
  - docs/dev/recovery-contract/EXECUTION-PHASE.zh-CN.md
  - harness/specs/tasks/execution-phase-commit.md
  - .gitignore
  - scripts/repository-artifacts.json
touchedAreas:
  - shared/recovery-contract/**
  - tests/unit/recovery-contract-execution-phase.test.ts
  - docs/dev/recovery-contract/**
  - harness/specs/tasks/execution-phase-commit.md
  - .gitignore
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - No default behavior changes. The lifecycle writer remains legacy unless explicitly selected, and the execution-phase writer remains legacy unless both it and the task-loop lifecycle writer are explicitly set to taskflow.
  - A restarted process classifies the last durable phase before re-entering effectful work. effect_pending always reconciles against the domain journal and never auto-replays.
  - TaskFlow remains the only lifecycle/phase row owner; domain journals remain the effect truth; long_task_checkpoints keep checkpoint material only; RuntimeTaskEventLog stays diagnostic and default off.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - replay that executes effects
  - a second phase ledger beside flow_runs
  - treating EffectReceipt, long_task_checkpoints, or RuntimeTaskEventLog as replay authority
  - turning the execution-phase writer on by default
  - enabling runtime.eventLog.* by default
featureFlags:
  - OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER remains legacy|projection|taskflow with legacy default.
  - OPENCLAW_EXECUTION_PHASE_WRITER is proposed as legacy|taskflow with legacy default; it may only write when the task-loop lifecycle writer is also taskflow.
  - runtime.eventLog.shadow/persist, runtime.checkpointSerializer.shadow and runtime.resume.replayShadow stay default false.
rollback:
  - Select legacy for the execution-phase writer (or the lifecycle writer); the phase writer freezes and existing flow_runs rows stay read-only evidence. Never dual-write. Reconcile any effect_pending or needsReconciliation row before declaring rollback complete.
requiredTests:
  - pnpm exec vitest run tests/unit/recovery-contract-execution-phase.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/execution-phase-commit.md
acceptance:
  - Status report acknowledges the real gaps in the current source: coarse lifecycle status only, no persisted execution phase, post-effect-only EffectReceipt, overwritable checkpoints, status-only orphan settlement, and unimplemented event-log replay.
  - The pure module exposes exactly eight phases, twelve legal transitions, a terminal family of three, and a replay classification where effect_pending is reconcile and effect_committed/failed are unsafe.
  - Unit tests exhaust all 64 ordered phase pairs, prove terminal phases have zero outgoing edges, prove same-phase commits are idempotent no-ops, and prove effect_pending is never classified safe.
  - The design document maps every transition to its CAS commit point, maps K1-K5 kill windows to a recovery verdict, explains how gateway startup settles previous-boot orphans as lost with phase preserved, and states why the default writer stays legacy plus its rollback path.
  - The implementation remains a draft: no production schema, writer, store, or default is changed; product locks remain false; event-log flags remain default off.
docs:
  required: true
  files:
    - docs/dev/recovery-contract/EXECUTION-PHASE.zh-CN.md
---

# Execution Phase Commit (TF-0717)

This is an implementation-before draft. It defines and tests the pure execution-phase
contract and the design that a later implementation must follow; it does not change a
production path.

## Problem

The current TaskFlow lifecycle owner persists only a coarse status. Task Loop explicitly
does not write TaskFlow for phase-only changes (`task-loop-controller.ts` caches the last
committed flow status), so a restart knows "running" but not whether the executor was
dispatched, an effect intent was committed, or an effect was applied. EffectReceipt is
written after the fact and explicitly never authorizes replay; `long_task_checkpoints`
are overwritable; gateway startup settles every non-terminal orphan as `lost` without
consulting any effect evidence; and event-log replay returns
`event_log_replay_not_implemented`.

## Deliverable

- A pure module under `shared/recovery-contract/` with the eight-phase enum, the explicit
  transition table, `canTransition()`, `isTerminalPhase()`, `classifyReplay()`, and a
  same-phase idempotent-commit decision.
- A unit test matrix covering legal transitions, illegal rejection, terminal absorption,
  `effect_pending -> recovery = reconcile`, and idempotent commit semantics.
- A Chinese design document with CAS commit points, K1-K5 kill windows, gateway restart
  settlement, default-legacy rationale, and rollback.

## Non-goals

- No production schema migration, no TaskFlow writer change, no default flip.
- No event-log replay implementation.
- No claim that checkpoint rollback restores runtime or external effects.

## Acceptance Evidence

The spec is accepted only when its `requiredTests` pass on a clean candidate and every
acceptance bullet is verified by reading the produced artifacts, not by trusting a
command's exit status alone.