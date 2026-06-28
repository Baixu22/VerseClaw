---
id: mission-control-loop-mvp
title: Verse Claw Mission Control long-goal loop MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add Mission Control as the outer long-goal control loop above bounded task_loop, so Verse Claw can run checkpointed, scheduled, evidence-driven missions without relying on a giant chat transcript.
touchedAreas:
  - harness/specs/tasks/mission-control-loop-mvp.md
  - docs/clawx-design-overview.md
  - shared/types/mission-control.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/agents/tools/mission-loop-tool.ts
  - openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts
  - electron/gateway/event-dispatch.ts
  - electron/main/index.ts
  - electron/services/mission-control-api.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/components/agents/**
  - src/components/task-ledger/**
  - src/pages/Observability/**
  - shared/i18n/locales
expectedUserBehavior:
  - Users can create a Mission from the Agents panel, Gateway RPC, or lead-agent mission_loop tool when a goal should survive multiple turns, sessions, or scheduled checks.
  - A Mission can be started manually, resumed from a checkpoint, or awakened by a scheduled/event tick without replaying the full transcript.
  - Verse Claw shows Mission phase, tick count, latest reviewer decision, blockers, next wake, Task Ledger mirrored evidence, and trace evidence.
  - The model can judge whether the Mission should continue, repair, sleep, ask the user, complete, or block based on evidence and acceptance criteria.
  - Memory changes discovered during a Mission become role-memory proposals or Knowledge Hub drafts; they are not silently written as long-term truth.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/mission-control-loop-mvp.md
  - pnpm exec vitest run tests/unit/mission-control-loop.test.ts tests/unit/mission-context-pack.test.ts tests/unit/mission-reviewer.test.ts tests/unit/host-events.test.ts tests/unit/task-ledger-service.test.ts
  - pnpm run typecheck
  - pnpm exec playwright test tests/e2e/mission-control-panel.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Mission Control is implemented as an outer controller; bounded task_loop remains the inner execution loop and keeps its repair/iteration caps.
  - Mission state has explicit terminal states and never completes without evidence-linked acceptance review.
  - Gateway exposes mission.create, mission.run, mission.tick, mission.status, mission.pause, mission.resume, and mission.cancel through the existing RPC boundary.
  - Renderer uses hostApi and HostEvents only; it does not add direct IPC, direct Gateway HTTP, or renderer-owned transport switching.
  - Mission lifecycle events flow Gateway broadcast -> Main -> HostEvents and include missionId, sessionKey, phase, status, tick, progress, reviewerDecision, nextWakeAt, blockedReason, traceId, and ts.
  - MissionContextPack is built from objective, acceptance criteria, latest ResumeCheckpoint, Task Ledger snapshot, selected memory context, recent evidence summaries, and reviewer summary; it does not dump full transcripts into reviewer prompts.
  - Runtime evidence from workers, tools, traces, and memory search is wrapped as untrusted data before being shown to reviewer or downstream workers.
  - MissionReviewer returns structured JSON with decision continue|repair|sleep|ask_user|complete|blocked, confidence, missingEvidence, repairBrief, nextTick, risks, memoryCandidates, and checkpointSummary.
  - Scheduled behavior reuses existing cron/wake infrastructure as a tick trigger; cron does not become the source of truth for Mission completion.
  - Repeated no-progress ticks, exhausted tick/repair budgets, missing permissions, or insufficient evidence end in blocked or ask_user instead of infinite unattended looping.
  - Memory candidates go through role-memory proposal or Knowledge Hub draft/review flows and preserve evidence refs.
  - `knowledge_draft` candidates create pending Knowledge Inbox items only, include a stable `metadata.captureKey`, and never call wiki.apply, applyReviewedChange, archive, delete, or merge.
  - Leaf subagents do not receive mission_loop, task_loop, or team_orchestrate unless an existing lead/orchestration policy explicitly grants them.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Mission Control is the Verse Claw long-goal layer. It is intentionally above task_loop:

- task_loop owns one bounded execution attempt with self-check and scoped repair.
- ClawGraph owns explicit DAG execution state for structured workflows.
- Task Ledger owns user-facing long-task truth.
- ResumeCheckpoint owns minimal continuation state after compaction, interrupt, abort, handoff, review, or session rotation.
- Mission Control owns the policy loop that decides when to run, sleep, repair, ask the user, complete, or block.

Initial implementation phases:

1. Add shared Mission types, lifecycle event contract, and config defaults.
2. Add MissionContextPack and MissionReviewer with deterministic fallback decisions.
3. Add MissionController with OpenClaw state SQLite persistence plus best-effort Task Ledger mirroring.
4. Add Gateway RPCs and a model-callable mission_loop tool for lead agents only.
5. Add scheduler integration that creates cron/wake ticks pointing at mission.tick, not free-form chat messages.
6. Add Verse Claw UI status surfaces in Agents and mirror trace/check/review evidence into Task Ledger.
7. Add unit, harness, comms, and E2E coverage before making Mission Control a public default.
