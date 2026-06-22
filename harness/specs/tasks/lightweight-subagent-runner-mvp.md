---
id: lightweight-subagent-runner-mvp
title: Lightweight Subagent Runner MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a preset-driven subagent runner so users can launch common role-first orchestration workflows from the UI without writing ClawGraph YAML.
touchedAreas:
  - harness/specs/tasks/lightweight-subagent-runner-mvp.md
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - src/components/agents/SubagentRunnerPanel.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - tests/unit/role-orchestration-methods.test.ts
  - tests/e2e/lightweight-subagent-runner.spec.ts
  - docs/clawx-design-overview.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Users can choose Explorer, Reviewer, Tester, or Compare 3 approaches from Agents -> Roles & Orchestration.
  - Users can enter a goal and start the selected preset without authoring ClawGraph YAML.
  - The runner shows the goal, participating roles, live status, result summary, failures, and an Observability trace link when available.
  - Reviewer uses the current workspace staged and unstaged diff by default and fails visibly when no diff is available.
  - The runner never auto-merges code and continues through the existing Gateway permission path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/lightweight-subagent-runner-mvp.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts
  - pnpm run test:e2e -- tests/e2e/lightweight-subagent-runner.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - orchestrator.plan and orchestrator.run accept an optional explicit workers array with known role names and per-worker tasks.
  - Explicit workers may contain duplicate roles and are tracked independently by task/worker identity.
  - Explorer and Reviewer have mocked E2E coverage for preset selection, launch, lifecycle display, summary, and trace link.
  - A failure path is covered in E2E and displays a localized failure reason.
  - All new user-facing text is translated in en, zh, ja, and ru.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This runner is a UI and orchestration wrapper over the existing role-first runtime. It must not introduce a renderer-owned transport, bypass workspace permission mode, or replace ClawGraph, Task Ledger, Mission Control, or Observability as their respective sources of truth.
