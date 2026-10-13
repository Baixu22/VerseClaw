---
id: chat-session-handoff-depth
title: Persist and validate session handoff lineage
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Guard handoff preparation and creation with persisted ancestry and preserve a bounded opt-in depth across forks and restarts.
touchedAreas:
  - shared/**
  - electron/services/**
  - src/lib/**
  - src/pages/Chat/**
  - openclaw_runtime/src/config/**
  - tests/unit/**
  - tests/e2e/chat-session-handoff.spec.ts
  - harness/specs/**
  - README*
  - docs/dev/session-handoff-depth*
expectedUserBehavior:
  - Creation records lineage in Main before the new conversation becomes active and never auto-sends the draft.
  - Cycles, conflicting ancestry, corrupt ledger and an incomplete ancestry walk refuse creation without changing the active session.
  - When runtime.handoff.enabled is true, maxDepth limits relay depth; the first relay is depth one and the implicit limit is three.
  - Forks inherit relay ancestry without adding a relay level; forking cannot reset an enabled handoff depth limit.
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
  - pnpm exec vitest run tests/unit/handoff-depth.test.ts tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts tests/unit/chat-session-continuity.test.ts tests/unit/host-api-facade.test.ts
  - pnpm exec playwright test tests/e2e/chat-session-handoff.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Both preview and creation re-read the authoritative persisted lineage; successful creation includes parent/root session keys and handoff event ids and depth.
  - Failed lineage reads and writes cannot report success or silently reset depth to zero.
  - Self-cycles and ancestry cycles are rejected; bounded walks that do not reach a root are rejected.
  - The new depth limit is opt-in and defaults off; existing subagent maxSpawnDepth and frozen product values are unchanged.
  - Config is accepted by the runtime schema and all new UI denial strings cover en/zh/ja/ru.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This implements the product session relay gap in issue 179. Subagent spawn already enforces maxSpawnDepth; model failover resumes the same controller and does not derive a session. Tests and acceptance are driven_by agent. TF-0284 also requires context-pressure and independent full-chain evidence, so this issue does not by itself close that broader node.
