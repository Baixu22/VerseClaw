---
lifecycleStatus: archived
id: loop-context-pack-contract
title: LoopContextPack recovery context contract
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make `/loop` the explicit long-task entry point and make LoopContextPack the single bounded recovery-context generator for loop resume, checkpoint, intervention, and handoff paths.
touchedAreas:
  - harness/specs/**
  - harness/specs/rules/chat-loop-boundary.md
  - harness/specs/tasks/loop-context-pack-contract.md
  - docs/clawx-design-overview.md
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - openclaw_runtime/src/agents/task-loop-*.ts
  - openclaw_runtime/src/agents/user-message-queue.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/state/openclaw-state-db.ts
  - electron/services/chat-api.ts
  - electron/services/sessions-api.ts
  - electron/services/task-ledger-*.ts
  - electron/services/knowledge-api.ts
  - shared/types/long-task-control.ts
  - shared/types/mission-control.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/pages/Chat/**
  - tests/unit/loop-context-pack.test.ts
  - tests/unit/long-task-control.test.ts
  - tests/unit/user-message-queue.test.ts
  - tests/unit/task-ledger-service.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/mission-context-pack.test.ts
  - tests/unit/chat-runtime-event-handlers.test.ts
  - tests/e2e/chat-long-task-control.spec.ts
expectedUserBehavior:
  - Ordinary Chat remains lightweight and does not enter `/loop` recovery, checkpoint, intervention, or Task Ledger root state unless the user explicitly starts `/loop`.
  - Starting `/loop` creates a Task Ledger root node and all loop checkpoints, interventions, decisions, deviations, evidence, review items, and terminal status stay attached to that root.
  - Users can guide, queue, interrupt, or revise the goal during `/loop`, and those interventions survive restart/resume with clear supersession metadata.
  - Resuming `/loop` uses a bounded LoopContextPack instead of replaying the full transcript or letting each subsystem assemble its own long-context prompt.
  - Automatic Knowledge deposition from `/loop` creates Inbox items/drafts/proposals only and never applies formal Knowledge without user confirmation.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - chat-loop-boundary
  - workspace-harness-single-source
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/loop-context-pack-contract.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/loop-context-pack.test.ts tests/unit/long-task-control.test.ts tests/unit/user-message-queue.test.ts tests/unit/task-ledger-service.test.ts tests/unit/task-loop-controller.test.ts tests/unit/mission-context-pack.test.ts tests/unit/chat-runtime-event-handlers.test.ts
  - pnpm exec playwright test tests/e2e/chat-long-task-control.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - `/loop` is the only long-task Chat entry path; ordinary Chat sends do not implicitly create Task Ledger roots or loop controller state.
  - `/loop` startup creates one Task Ledger root node before the first recoverable checkpoint/intervention state is written; inability to create the root blocks loop startup with a diagnostic instead of running detached.
  - Every `/loop` checkpoint, intervention, decision, deviation, evidence ref, review item, session link, and terminal complete/blocked/cancelled status carries the same Task Ledger root id.
  - Intervention modes `guide`, `queue`, `interrupt`, and `revise-goal` are persisted with ordering, source session/run, timestamps, and supersession/revision metadata where applicable.
  - LoopContextPack is the only generator for `/loop` recovery context. Chat, Work Mode/intensity controls, Knowledge, Task Ledger, Mission, and renderer code must not each concatenate separate long-context prompts for loop resume.
  - LoopContextPack has stable priority order, budget limits, truncation metadata, source refs, and a deterministic hash so resume inputs are auditable.
  - LoopContextPack may include system/app rules, project rules, `/loop` initial constraints, user interventions, architecture principles, Task Ledger current state, ResumeCheckpoint, relevant read-only Knowledge, Role Memory, and transcript summary; conflicts prefer earlier priority sections.
  - Project rules in LoopContextPack come from `AGENTS.md` plus `harness/specs/**`; `.clawx/rules/*.md` may be included only as supplemental workspace material.
  - Knowledge auto-deposition from loop evidence can only create Knowledge Inbox items, drafts, or proposals; it cannot call apply/archive/delete/merge directly.
  - ExecutionGraph remains a turn/run projection for ordinary Chat and must not be reused as the loop's durable task tree.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

LoopContextPack is a recovery carrier, not a second task database. The durable long-task shape lives under the Task Ledger root for the loop; execution evidence lives in runtime events, files changed, approvals, traces, and transcript records; reusable knowledge enters governed Knowledge review surfaces only.

The intended split is:

- Ordinary Chat uses transcript plus runtime turn events, files changed, and approvals.
- `/loop` uses Task Ledger root state plus persisted checkpoints/interventions and a bounded LoopContextPack.
- Knowledge and Memory provide read-only context or reviewed candidate writes; they do not assemble private long-task recovery prompts.
