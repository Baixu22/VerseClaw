---
lifecycleStatus: archived
id: chat-session-control-isolation
title: Keep asynchronous chat controls attached to their source conversation
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: f4c4c0f6651114162f9f0bc944bf8c2c1e30f8df
intent: Reproduce and repair stale chat dialogs and control responses after switching conversations.
expectedUserBehavior:
  - Switching conversations closes the previous conversation's compression and handoff dialogs.
  - Late responses from a previous conversation never replace the current control state or reopen an old draft.
  - A delayed cache-risk confirmation cannot trigger compression after the user leaves its conversation.
  - Completing an old task-loop upgrade does not erase a draft typed in a new conversation.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-manual-compaction.spec.ts
  - docs/dev/chat-session-control-isolation.md
  - harness/specs/tasks/chat-session-control-isolation.md
docs:
  required: true
  paths:
    - docs/dev/chat-session-control-isolation.md
requiredTests:
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/chat-page-execution-graph.test.tsx --maxWorkers=1
  - pnpm exec playwright test tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-manual-compaction.spec.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Regression tests reproduce stale controls before the fix and pass afterward, including delayed responses and changing away and back to a conversation.
  - Real Electron coverage verifies that delayed handoff preparation does not appear in another conversation.
  - Existing compression, handoff and chat input behavior remains covered without changing timeouts, retry budgets, permissions or product defaults.
---

This is a bounded audit of conversation control ownership, not an assertion
that every program path has been audited. All verification is agent-driven.
