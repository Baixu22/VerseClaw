---
id: long-conversation-control-hardening-v1
title: Long conversation control checkpointed recovery hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Persist human-intervention queue state and resume checkpoints so long Chat runs can recover after compaction, interruption, abort, or Gateway restart without relying on the full transcript.
touchedAreas:
  - shared/types/long-task-control.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/pages/Chat/**
  - shared/i18n/locales
  - openclaw_runtime/src/agents/user-message-queue.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/state/**
expectedUserBehavior:
  - Chat shows queued follow-up count, latest checkpoint, latest intervention, and recovery warnings for the current session.
  - Queue input mode persists the follow-up until it is drained, including across Gateway restart.
  - Guide input mode records steering evidence without aborting the active run.
  - Interrupt input mode records a checkpoint/deviation before aborting and starting a fresh run.
  - Idle sessions can manually drain queued follow-ups through Host API.
  - Manual compaction remains disabled during active runs and does not mutate Task Ledger.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/long-task-control.test.ts tests/unit/user-message-queue.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-input.test.tsx
  - pnpm exec playwright test tests/e2e/chat-long-task-control.spec.ts tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-run-state-events.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Runtime long-task control state is persisted in OpenClaw state SQLite, not sidecar JSON/JSONL files.
  - Renderer uses Host API and host events only; it does not call Gateway or read transcripts directly.
  - Gateway unavailable responses include stable diagnostics instead of silent fallback.
  - Queue drain is idempotent and does not lose pending messages on failure.
  - Resume checkpoints are queryable and can seed session handoff.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This hardening layer does not prove task completion and does not replace Task Ledger, ClawGraph, memory, or observability. It preserves the minimum continuation state needed for a new run to continue safely after conversation pressure or lifecycle disruption.
