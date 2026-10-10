---
lifecycleStatus: archived
id: chat-session-runtime-fork
title: Chat session runtime fork
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a runtime-backed Fork action that creates a new Chat conversation branch inheriting the source transcript without sending a message.
touchedAreas:
  - harness/specs/tasks/chat-session-runtime-fork.md
  - openclaw_runtime/packages/gateway-protocol/**
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/auto-reply/reply/session-fork*
  - shared/host-api/contract.ts
  - shared/types/task-ledger.ts
  - electron/services/sessions-api.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-ledger-service.ts
  - src/lib/host-api.ts
  - src/lib/workspace-session.ts
  - src/pages/Chat/**
  - shared/i18n/locales
  - tests/unit/**
  - tests/e2e/**
expectedUserBehavior:
  - Users can fork the active Chat session from session controls or the composer continuity recommendation.
  - The composer context area shows only the locally recommended continuity action, while the session dropdown keeps both Fork and Handoff and marks the recommended item.
  - Handoff is recommended when reliable recovery context or a recovery checkpoint exists, because ResumeCheckpoint + Task Ledger + evidence is safer than transcript branching for recovery states.
  - Fork creates a new workspace-scoped conversation branch, immediately switches to it, and shows inherited source transcript history.
  - Fork does not generate a handoff prompt and does not auto-send.
  - Fork does not copy Task Ledger nodes, Memory, Knowledge, or workflow truth; durable task truth remains in Task Ledger and only session relationship links may be appended.
  - Fork is disabled while the active session is running or streaming, and backend services reject active-run fork requests.
  - Fork failure does not create an isolated empty replacement session and can offer an explicit Prepare handoff fallback based on ResumeCheckpoint, Task Ledger, and evidence when appropriate.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts tests/unit/task-ledger-service.test.ts
  - pnpm exec playwright test tests/e2e/chat-session-fork.spec.ts tests/e2e/chat-session-handoff.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer uses hostApi.sessions.fork and does not read transcript files or call Gateway directly.
  - Gateway exposes sessions.fork and returns only after the child transcript branch and session store entry are created.
  - Forked child sessions record parentSessionKey and forkedFromParent metadata, inherit runtime selection, and do not auto-send.
  - Main does not locally copy transcript files when Gateway is unavailable.
  - Workspace session persistence selects the forked child and preserves non-running UI state.
  - Handoff prepare is recovery/checkpoint-first and still merges Task Ledger, Git status, observability, and transcript fallback sources into one ResumeCheckpoint rendering context.
  - Handoff drafts are deterministic reviewable recovery packages with current objective, recently confirmed work, in-progress state, blockers/risks, evidence sources, and next-action sections.
  - Renderer continuity preflight is local-only guidance over existing status surfaces; it does not add a second task truth source or bypass Host API boundaries.
  - Renderer continuity preflight exposes healthy/risky/blocked guidance without adding another entry point or changing Main/Gateway semantics.
  - Forked child sessions retain parent lineage metadata for navigation, but task truth remains in Task Ledger session links and checkpoint/evidence state.
  - Handoff-created sessions link Task Ledger with relation `handoff_from`, `sourceSessionKey`, and child `sessionKey`; fork-created sessions link with relation `forked_from`.
  - Fork/Handoff continuity entry points preserve user-intent state only, clear running UI state after switching, and never auto-fallback without user confirmation.
  - Full locale coverage is added for visible fork UI strings.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Runtime Fork is distinct from Handoff: Fork clones the current runtime transcript branch into a new session, while Handoff creates an editable continuation draft for a fresh session from runtime recovery context, ResumeCheckpoint, Task Ledger, Git, trace, and transcript fallback evidence. The continuity UI recommends between them through local preflight, but both explicit choices remain available from the session dropdown. Neither feature creates a parallel task truth system: Task Ledger remains durable work state, ResumeCheckpoint remains the continuation contract, and Memory/Knowledge are not written automatically by this flow.
