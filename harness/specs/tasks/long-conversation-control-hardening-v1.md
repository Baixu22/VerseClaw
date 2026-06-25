---
id: long-conversation-control-hardening-v1
title: Long conversation control checkpointed recovery hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Persist human-intervention queue state and resume checkpoints so long Chat runs can recover after compaction, interruption, abort, or Gateway restart without relying on the full transcript.
touchedAreas:
  - shared/types/long-task-control.ts
  - shared/types/mission-control.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/services/sessions-api.ts
  - electron/services/chat-api.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/pages/Chat/**
  - shared/i18n/locales
  - openclaw_runtime/src/agents/user-message-queue.ts
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - openclaw_runtime/src/agents/long-conversation-control-signals.ts
  - openclaw_runtime/src/agents/task-loop-*.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/state/**
expectedUserBehavior:
  - Chat shows queued follow-up count, latest checkpoint, latest intervention, and recovery warnings for the current session.
  - Queue input mode persists the follow-up until it is drained, including across Gateway restart.
  - Guide input mode records steering evidence without aborting the active run.
  - Interrupt input mode records a checkpoint/deviation before aborting and starting a fresh run.
  - Idle sessions can manually drain queued follow-ups through Host API.
  - Manual compaction remains disabled during active runs and does not mutate Task Ledger.
  - Mission Loop and Task Loop reviewers emit bounded Engineering Control Signals for evidence gaps, missing validation, scope drift, unverified claims, and replan needs.
  - Complete decisions are downgraded when blocking control signals, missing validation, or missing acceptance remain.
  - Thinking intensity and response intensity remain untrusted Chat preferences; they do not carry long-task control contracts, change permissions, or toggle capabilities.
  - `/loop` is the explicit long-task entry; ordinary Chat does not create Task Ledger root nodes or enter checkpoint/intervention state machines by default.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - chat-loop-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/long-task-control.test.ts tests/unit/mission-reviewer.test.ts tests/unit/mission-context-pack.test.ts tests/unit/mission-control-loop.test.ts tests/unit/task-loop-controller.test.ts tests/unit/loop-context-pack.test.ts tests/unit/task-ledger-service.test.ts tests/unit/host-events.test.ts tests/unit/chat-knowledge-scope.test.ts
  - pnpm exec vitest run tests/unit/user-message-queue.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-input.test.tsx
  - pnpm exec playwright test tests/e2e/chat-long-task-control.spec.ts tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-run-state-events.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Runtime long-task control state is persisted in OpenClaw state SQLite, not sidecar JSON/JSONL files.
  - Renderer uses Host API and host events only; it does not call Gateway or read transcripts directly.
  - Gateway unavailable responses include stable diagnostics instead of silent fallback.
  - Queue drain is idempotent and does not lose pending messages on failure.
  - Resume checkpoints are queryable and can seed session handoff.
  - Resume checkpoints store only bounded recovery state plus `controlSignals`, `validationState`, and `acceptanceStatus`; they never replay the full transcript.
  - `evidence_gap`, `validation_missing`, `scope_drift`, `unverified_claim`, and `replan_required` can be represented in reviewer output, context packs, lifecycle events, and Task Ledger node metadata.
  - Observability traces and inner `task_loop` complete results are evidence only; they cannot by themselves complete a Mission or Task Ledger goal.
  - Task Ledger review/check nodes may receive `longConversationControl` metadata and evidence-gap/scope-drift/validation-missing tags, but review clearing remains explicit.
  - User intervention modes `guide`, `queue`, `interrupt`, and `revise-goal` persist evidence and recovery state instead of existing only in the renderer.
  - Loop recovery context is generated through LoopContextPack; Chat, Work Mode/intensity controls, Knowledge, and Task Ledger do not assemble separate long-context prompts.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This hardening layer does not prove task completion and does not replace Task Ledger, ClawGraph, memory, Mission state, thinking/response intensity preferences, or observability. It preserves the minimum continuation state needed for a new run to continue safely after conversation pressure or lifecycle disruption.

Engineering Control Signals are an internal contract, not a new prompt system or progress source. Existing long-conversation loops should use them to make evidence gaps, missing validation, scope drift, unverified claims, and replan requirements explicit during plan/build/review/recovery decisions.
