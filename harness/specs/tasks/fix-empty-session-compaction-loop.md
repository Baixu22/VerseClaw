---
id: fix-empty-session-compaction-loop
title: Avoid auto-compaction loops before the first conversation message
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Do not invoke compaction when pre-prompt pressure comes only from bootstrap context and the session has no real conversation history.
touchedAreas:
  - harness/specs/tasks/fix-empty-session-compaction-loop.md
  - openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts
expectedUserBehavior:
  - A first message in a session with a small configured context budget is submitted without retrying empty-session compaction.
  - A non-empty conversation keeps the existing compaction route.
  - If the provider rejects an intrinsically oversized first prompt, the run returns a bounded context-overflow error instead of looping.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-empty-session-compaction-loop.md
  - pnpm harness validate --spec harness/specs/tasks/fix-empty-session-compaction-loop.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-embedded-agent.config.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Empty sessions with no real conversation messages never select compact_only solely because reserve tokens exceed the available prompt budget.
  - Existing real conversation messages continue to select compact_only when their estimated prompt exceeds the budget.
  - The change uses the shared real-conversation classifier rather than a role or message-count heuristic.
docs:
  required: false
  note: This is an internal recovery-boundary fix; public README behavior and interfaces are unchanged.
---
