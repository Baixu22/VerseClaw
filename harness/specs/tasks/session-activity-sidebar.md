---
lifecycleStatus: archived
id: session-activity-sidebar
title: Session activity sidebar and recovery settings
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the Chat recovery rail with a structured, event-backed session activity view and move recovery controls into Settings.
touchedAreas:
  - shared/types/session-activity.ts
  - shared/host-events/contract.ts
  - shared/host-api/contract.ts
  - src/stores/session-activity.ts
  - src/pages/Chat/**
  - src/pages/Settings/**
  - src/stores/settings.ts
  - electron/services/**
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
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
expectedUserBehavior:
  - Chat shows structured session, Git, task, sub-agent, terminal, and continuity activity only when real data exists.
  - Recovery actions are available from Settings > Session & Recovery and are derived from real recovery evidence.
  - Runtime events are isolated by session and stale/out-of-order events cannot overwrite terminal state.
  - Mock query scenarios provide deterministic visual activity without pretending ordinary chat has percentage progress.
acceptance:
  - The Chat rail no longer renders RollbackPlanPanel or a duplicate Task Ledger summary.
  - Ordinary Chat Runtime shows a phase without a percentage; only backend progress fields render progress bars.
  - Git file counts use status.changes.length and settings defaults persist through the typed Host API.
  - Renderer backend calls use src/lib/host-api.ts and no direct IPC or Gateway HTTP.
requiredTests:
  - pnpm exec vitest run tests/unit/session-activity.test.ts tests/unit/rollback-plan.test.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This task keeps recovery operations approval-backed and moves their presentation out of the Chat message flow. Activity is a projection of structured Host events and snapshots; transcript text is never used to infer task or agent state.
