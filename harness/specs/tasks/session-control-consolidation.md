---
id: session-control-consolidation
title: session_control consolidated session/task control surface
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consolidate the everyday session/goal tools into one action-based `session_control` tool with legacy aliases and policy parity, plus a read-only Chat header card with user-only goal lifecycle actions. Enabled behind `tools.experimental.sessionControl` (default off).
touchedAreas:
  - harness/specs/tasks/session-control-consolidation.md
  - openclaw_runtime/src/agents/tools/session-control-tool.ts
  - openclaw_runtime/src/agents/tools/session-control-tool.test.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/agent-tools.policy.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/prompt-surface.ts
  - openclaw_runtime/src/agents/system-prompt.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/tools/common.ts
  - openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - src/pages/Chat/index.tsx
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - shared/host-api/contract.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
  - src/pages/Chat/SessionTaskHeaderCard.tsx
  - tests/unit/session-task-header-card.test.tsx
  - tests/e2e/session-task-header-card.spec.ts
expectedUserBehavior:
  - The active agent can use one `session_control` tool for spawn/send/status/list/history/compact/yield/goal/subagents instead of nine separate session tools.
  - Legacy `sessions_*`/`goal`/`subagents` names remain callable aliases with identical per-action policy enforcement.
  - Users see a compact Session Task card in the Chat header with goal status, budget, lineage, compaction, and long-task state, and can start/pause/resume/complete/block the goal while it is disabled during streaming.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/session-control-tool.test.ts
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/session-task-header-card.test.tsx
  - pnpm exec playwright test tests/e2e/session-task-header-card.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - `session_control` is assembled only when `tools.experimental.sessionControl` is true; flag-off inventories are unchanged.
  - All eight/nine actions delegate to the existing single-purpose tools; no new transport or task truth source is introduced.
  - Legacy session/goal tool names remain executable and resolve to the same per-action policy names.
  - Model goal status updates stay limited to complete|blocked; start/pause/resume/clear remain user `/goal` command actions.
  - Leaf sub-agent deny semantics (spawn/list/history/subagents/send/status) stay enforced for the consolidated tool via action-level policy narrowing.
  - The Chat header card reads runtime state through existing host-api surfaces and sends `/goal <action>` through the existing chat send path, disabled while streaming.
  - New user-visible text is localized in en/zh/ja/ru.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

## Scope

`team_orchestrate`, `task_loop`, `mission_loop`, and `update_plan` stay independent tools and are not folded into `session_control`.

## Actions

spawn, send, status, list, history, compact, yield, goal, subagents. Each action maps to one legacy policy name; `goal` maps to `update_goal` (most sensitive write op) so configured allow/deny lists stay fail-closed.