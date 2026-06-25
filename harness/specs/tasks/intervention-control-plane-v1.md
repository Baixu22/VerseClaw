---
id: intervention-control-plane-v1
title: Intervention control plane and rollback recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Mature terminal intervention, queued follow-ups, context recovery, rollback planning, Task Ledger evidence, and governed memory/tool effects into one auditable control plane.
touchedAreas:
  - shared/types/long-task-control.ts
  - shared/host-api/contract.ts
  - src/pages/Chat/**
  - src/components/file-preview/**
  - src/components/task-ledger/**
  - electron/services/sessions-api.ts
  - electron/services/terminal-api.ts
  - electron/services/git-api.ts
  - electron/services/permissions-api.ts
  - electron/services/knowledge-api.ts
  - openclaw_runtime/src/agents/user-message-queue.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - tests/unit/**
  - tests/e2e/**
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
expectedUserBehavior:
  - Users can see a rollback/recovery plan from Chat that summarizes checkpoint, queue, compaction, Git rollback, Task Ledger, memory, and terminal risk.
  - Queue, guide, interrupt, terminal, Git, file, and memory-affecting actions produce structured intervention records and Task Ledger evidence.
  - Queue drain is idempotent, durable across Gateway restart, and never loses queued messages on failure.
  - Destructive rollback actions are review-first and approval-backed; the UI must not silently discard workspace edits or memory.
  - Context recovery prefers bounded checkpoints, handoff drafts, and manual compaction over replaying full transcripts.
  - Memory changes discovered during rollback become Knowledge drafts or memory proposals, not silent durable writes.
acceptance:
  - Chat renders a rollback plan whenever recovery evidence, queued work, context pressure, active run risk, or file rollback options are relevant.
  - Rollback plan actions call existing typed Host API/UI routes only; renderer never calls Gateway HTTP or IPC directly.
  - Rollback plan distinguishes safe, review, and dangerous actions and tells users destructive rollback requires approval-backed tools.
  - Queue drain and manual compaction remain disabled or review-gated in active-run states according to existing policies.
  - Git/file rollback actions continue through `permissions` approvals and emit evidence that Task Ledger can link.
  - Context checkpoints include control signals, validation state, acceptance status, and evidence refs while staying bounded.
  - Unit tests cover rollback plan derivation from checkpoint, queue, compaction, and active-run inputs.
  - Electron E2E covers visible rollback plan actions and at least one action handoff into Host API/UI.
requiredTests:
  - pnpm exec vitest run tests/unit/rollback-plan.test.ts tests/unit/long-task-control.test.ts tests/unit/user-message-queue.test.ts tests/unit/chat-input.test.tsx
  - pnpm exec playwright test tests/e2e/chat-long-task-control.spec.ts tests/e2e/chat-manual-compaction.spec.ts tests/e2e/workspace-git-panel.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
docs:
  required: true
  note: Keep the rollback/recovery behavior documented near long conversation and Task Ledger docs when the control plane changes.
---

This task does not replace Chat, Task Ledger, Knowledge Hub, Git, Terminal, or Mission Control. It defines the connecting control plane: every intervention should have a bounded recovery state, explicit risk, typed action path, approval/evidence trail, and a user-visible route back to safe continuation.
