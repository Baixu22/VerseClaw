---
lifecycleStatus: active
id: electron-session-loading-regression
title: Long-lived session loading and label hydration regression for TF-0423
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Bound sidebar transcript summary reads and label sweeps so long-lived session histories cannot turn into whole-file scans or repeated transcript sweeps, without changing default product locks.
touchedAreas:
  - electron/services/sessions-api.ts
  - src/stores/chat.ts
  - src/components/layout/Sidebar.tsx
  - tests/unit/sidebar-render-containment.test.tsx
  - shared/host-api/contract.ts
  - tests/unit/host-services.test.ts
  - tests/unit/session-summary-bounded-read.test.ts
  - tests/unit/chat-session-label-budget.test.ts
  - harness/specs/tasks/electron-session-loading-regression.md
  - harness/specs/fixtures/tf0423-session-loading/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Long-lived users with hundreds of sessions see the sidebar fill in without the app reading every transcript in full.
  - Session switching stays responsive while a bounded label sweep is in flight.
  - No product lock or default setting changes; the fix is a read-path and scheduling change only.
requiredTests:
  - tests/unit/session-summary-bounded-read.test.ts
  - tests/unit/chat-session-label-budget.test.ts
  - tests/unit/host-services.test.ts
acceptance:
  - "sessions.summaries reads only a 64 KiB head and 128 KiB tail per transcript, dedupes keys, caps one request at 100 sessions, and reads sessions.json once per agent."
  - Summary workers are bounded to 8 concurrent transcript reads.
  - The renderer hydrates at most 40 missing labels per sweep, batches at 40, and skips implicit sweeps for 30 seconds.
  - A synthetic 333-session / ~60 MB set completes before/after measurement on a real Electron build.
  - Five-minute idle RSS shows no persistent monotonic growth.
  - All required unit tests, typecheck:node/web/test, contract check, harness validation and agent-dev:fast pass.
docs:
  required: false
---

# TF-0423 Long-lived session loading regression

## Objective

Keep sidebar session loading and label completion stable as local session
histories grow to hundreds of sessions and tens of megabytes.

## Scope

- `sessions.summaries` reads only a bounded head (64 KiB) and tail (128 KiB) of
  each transcript instead of the whole file.
- One `sessions.summaries` request dedupes keys, caps at 100 sessions, and reads
  `sessions.json` once per agent.
- Transcript summary workers are bounded to 8 concurrent reads.
- Renderer label hydration processes at most 40 missing labels per sweep,
  batches requests at 40, and skips implicit sweeps for 30 seconds.
- `SessionSummary.messageCount` becomes optional because a bounded read cannot
  count messages without scanning the whole file.

## Acceptance

- `pnpm exec vitest run tests/unit/session-summary-bounded-read.test.ts tests/unit/chat-session-label-budget.test.ts tests/unit/host-services.test.ts` passes.
- `pnpm run typecheck:node`, `typecheck:web`, `typecheck:test` pass.
- `pnpm contract:check` passes.
- `pnpm harness validate --spec harness/specs/tasks/electron-session-loading-regression.md` passes.
- The `probe.mjs` fixture produces before/after reports for the synthetic
  333-session / ~60 MB set with `driven_by: agent`.
