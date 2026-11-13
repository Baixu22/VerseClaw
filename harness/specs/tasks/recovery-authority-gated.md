---
lifecycleStatus: active
id: recovery-authority-gated
title: Gate all five recovery owners through one durable admission policy
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete TF-0715 with owner-bound, durable recovery decisions and finite attempts for main sessions, subagents, final delivery, ACP, and goal-wake; prepare the existing frozen GA acceptance without changing defaults or thresholds.
diffBase: 05d787213
humanEvidence: not-required
touchedAreas:
  - harness/specs/tasks/recovery-authority-gated.md
  - harness/specs/rules/recovery-authority-owner-admission.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - shared/recovery-authority/**
  - openclaw_runtime/src/agents/recovery-authority/**
  - openclaw_runtime/src/agents/execution-phase/**
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.recovery-admission.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.spawn-workspace.test-support.ts
  - openclaw_runtime/src/agents/embedded-agent-subscribe.ts
  - openclaw_runtime/src/agents/embedded-agent-subscribe.types.ts
  - openclaw_runtime/src/agents/embedded-agent-subscribe.handlers.lifecycle.ts
  - openclaw_runtime/src/agents/embedded-agent-subscribe.handlers.messages.ts
  - openclaw_runtime/src/agents/embedded-agent-subscribe.handlers.types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/extensions/codex/src/app-server/run-attempt.ts
  - openclaw_runtime/src/agents/command/attempt-execution.ts
  - openclaw_runtime/src/agents/command/types.ts
  - openclaw_runtime/src/agents/cli-runner.ts
  - openclaw_runtime/src/agents/cli-runner/types.ts
  - openclaw_runtime/src/agents/harness/lifecycle.ts
  - openclaw_runtime/src/agents/failover-error.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-execution.ts
  - openclaw_runtime/src/auto-reply/reply/followup-runner.ts
  - openclaw_runtime/src/auto-reply/reply/followup-runner.recovery-identity.test.ts
  - openclaw_runtime/src/agents/rc02-cli-entry.acceptance.test.ts
  - openclaw_runtime/src/gateway/session-lifecycle-state.ts
  - openclaw_runtime/src/agents/recovery-authority/main-session-admission.test.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery*
  - openclaw_runtime/src/agents/subagent-orphan-recovery*
  - openclaw_runtime/src/agents/subagent-recovery-state*
  - openclaw_runtime/src/agents/subagent-registry-steer-runtime.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry-run-manager.ts
  - openclaw_runtime/src/agents/subagent-registry-run-manager*.test.ts
  - openclaw_runtime/src/agents/subagent-registry-helpers.ts
  - openclaw_runtime/src/agents/subagent-registry-lifecycle.ts
  - openclaw_runtime/src/agents/subagent-registry-owners.recovery.test.ts
  - openclaw_runtime/src/agents/goal-wake-recovery*
  - openclaw_runtime/src/agents/goal-wake-dispatch.ts
  - openclaw_runtime/src/agents/command/delivery*
  - openclaw_runtime/src/agents/command/attempt-execution.shared.ts
  - openclaw_runtime/src/agents/command/session-store.ts
  - openclaw_runtime/src/agents/agent-command.ts
  - openclaw_runtime/src/channels/message/send.ts
  - openclaw_runtime/src/acp/control-plane/manager.runtime-resume-state.ts
  - openclaw_runtime/src/acp/control-plane/manager.turn-runner.ts
  - openclaw_runtime/src/acp/control-plane/manager.types.ts
  - openclaw_runtime/src/acp/control-plane/manager*.test.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/config/sessions/store-load.ts
  - openclaw_runtime/src/config/sessions/store.ts
  - openclaw_runtime/src/config/sessions/store-sqlite.ts
  - openclaw_runtime/src/gateway/server-methods/agent*.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent*.ts
  - openclaw_runtime/src/config/sessions.owner-admission.test.ts
  - openclaw_runtime/src/gateway/server-methods/agent.recovery-admission.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent.workspace.test.ts
  - openclaw_runtime/src/plugins/session-entry-slot-keys.ts
  - openclaw_runtime/src/infra/outbound/**
  - openclaw_runtime/src/infra/delivery-queue-sqlite.ts
  - tests/unit/recovery-authority*.test.ts
  - tests/unit/session-lifecycle-generation-barrier.test.ts
  - tests/e2e/recovery*.spec.ts
  - scripts/recovery*.mjs
  - scripts/recovery-owner-process-proof-child.mts
  - scripts/recovery-delivery-process-proof-child.mts
  - docs/modules/resources-and-observability.md
  - docs/dev/recovery-contract/**
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/**
  - scripts/repository-artifacts.json
  - .gitignore
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - runtime-authority-convergence-boundary
  - runtime-lifecycle-governance-boundary
  - recovery-authority-owner-admission
expectedUserBehavior:
  - An explicit authority gate makes all five existing recovery owners consult the same decision policy before mutation or continuation.
  - A failed or interrupted admission consumes its durable attempt; repeating the same boundary cannot start an independent recovery or repeat an uncertain effect.
  - One gate returns all five entries to their existing recovery paths; the default remains legacy and shadow remains read-only.
requiredTests:
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.recovery-admission.test.ts
  - openclaw_runtime/src/agents/subagent-registry-owners.recovery.test.ts
  - node scripts/recovery-owner-process-proof.mjs
  - openclaw_runtime/src/gateway/server-methods/agent.recovery-admission.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent.workspace.test.ts
  - openclaw_runtime/src/agents/recovery-authority/owner-admission.test.ts
  - openclaw_runtime/src/agents/subagent-orphan-recovery.admission.test.ts
  - openclaw_runtime/src/agents/execution-phase/redispatch.test.ts
  - openclaw_runtime/src/agents/subagent-registry-run-manager.recovery.test.ts
  - openclaw_runtime/src/config/sessions.owner-admission.test.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery.flow.test.ts
  - openclaw_runtime/src/agents/rc02-cli-entry.acceptance.test.ts
  - openclaw_runtime/src/infra/outbound/delivery-recovery.flow.test.ts
  - openclaw_runtime/src/infra/outbound/delivery-final-session.flow.test.ts
  - node scripts/recovery-delivery-process-proof.mjs
  - openclaw_runtime/src/agents/goal-wake-recovery.test.ts
  - tests/unit/recovery-authority-contract.test.ts
  - tests/unit/recovery-contract-eval.test.ts
acceptance:
  - All five real entry points query recoveryAuthorityV1 in gated mode; adapters describe observed facts rather than independently authorizing effects.
  - Owner identity, boundary digest, decision, attempt consumption, and pending admission commit together in the existing owner store before a continuation.
  - Concurrent and repeated admissions of the same boundary produce one continuation; failed, ambiguous, and unacknowledged attempts remain recorded across a real process restart.
  - Unknown effects always reconcile; applied or reconciled delivery effects settle without another send; a receipt or transcript alone cannot authorize replay.
  - A stale lifecycle, replaced payload, changed session generation, or stale ACP identity cannot receive an old admission acknowledgement or terminal callback.
  - Completed admitted recoveries reject replay; provider fallback within one unfinished command retains its admission until the command commits its terminal state.
  - Subagent failure attempts are persisted before RPC and cannot restart an unbounded retry burst; successful registry remapping stays owned by the existing subagent registry.
  - Goal-wake remains level-triggered and never respawns an uncertain durable helper; task terminal state and the wait reconciliation remain idempotent after restart.
  - ACP observed output prevents a fresh turn, and an early backend exit without effect truth is not treated as proof that no effect occurred.
  - Final delivery reuses the existing durable send owner and intent; pending text is preserved when the outcome is uncertain.
  - Final-delivery reconciliation binds and releases one current PID/epoch in the original queue without consuming a dispatch attempt; an uncertain or failed observation remains recoverable.
  - Authority queue write failures stop the platform send, and applied queue truth remains while an unmatched Session still references that intent.
  - A single authority-mode switch restores legacy behavior; no product default, product lock, frozen workload, retry limit, or acceptance threshold is relaxed.
  - A clean source candidate, production-path tests, fresh structured autoreview, source-bound artifacts, hash verification, and zero credential scan hits precede node closure.
  - GA readiness requires the unchanged five windows, at least three repeats per window, at least thirty live-provider pairs, nine passing frozen metrics, baseline repeat consistency, and required full source/package gates; incomplete evidence stays NO-GO.
docs:
  required: true
  files:
    - docs/dev/recovery-contract/GA-READINESS-20261106.md
---

TF-0715 is the existing owner-migration task. The November 6 request authorizes
continuing its implementation and preparing GA, with one owner slice active at
a time. TaskFlow owns tool phase/CAS; session, message delivery, ACP, and durable
process owners retain their respective truth. RecoveryAuthority decides from
those facts. It does not create another executor, queue, event store, or database.

The November 5/6 negative evidence remains bound to its original source. New
measurements must use the new candidate and cannot inherit earlier K5 success.
