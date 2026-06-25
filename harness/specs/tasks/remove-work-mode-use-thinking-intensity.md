---
id: remove-work-mode-use-thinking-intensity
title: Remove Work Mode and use thinking intensity
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Retire Work Mode as a durable Chat state and capability switch, replacing it with explicit thinking intensity and response intensity preferences while preserving ordinary Chat capability parity.
touchedAreas:
  - harness/specs/**
  - harness/specs/rules/chat-loop-boundary.md
  - harness/specs/tasks/remove-work-mode-use-thinking-intensity.md
  - docs/clawx-design-overview.md
  - shared/types/work-mode.ts
  - shared/types/work-provider.ts
  - shared/types/workspace.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/services/chat-api.ts
  - electron/services/work-providers-api.ts
  - src/lib/workspace-session.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/stores/settings.ts
  - src/stores/workspaces.ts
  - src/pages/Chat/**
  - src/pages/Settings/**
  - src/components/chat/**
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/work-mode.test.ts
  - tests/unit/work-mode-summary-panel.test.tsx
  - tests/unit/chat-agent-effort-popover.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/settings-page-remote-control.test.tsx
  - tests/unit/workspaces-store.test.ts
  - tests/unit/workspace-session.test.ts
  - tests/e2e/chat-work-mode.spec.ts
  - tests/e2e/work-mode-intensity.spec.ts
  - tests/e2e/effort-intensity-smoke.spec.ts
expectedUserBehavior:
  - Users choose thinking intensity/reasoning effort and response intensity/context density as lightweight Chat preferences.
  - Ordinary Chat keeps full capability access to files, code, terminal, MCP, Skills, Office artifacts, Web, and read-only Knowledge when the underlying permissions and providers allow them.
  - Removing Work Mode does not remove Office, Web, MCP, Skill, or Knowledge read capabilities from Chat.
  - Plan/Build/Review/Docs/Data labels no longer act as durable state, long-task phase, permission mode, tool bundle authority, or capability switch.
  - Intensity preferences affect only model thinking effort and response/context density; they do not create Task Ledger roots, checkpoints, intervention queues, or loop state.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - chat-loop-boundary
  - workspace-harness-single-source
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/remove-work-mode-use-thinking-intensity.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/work-mode.test.ts tests/unit/work-mode-summary-panel.test.tsx tests/unit/chat-agent-effort-popover.test.tsx tests/unit/chat-knowledge-scope.test.ts tests/unit/settings-page-remote-control.test.tsx tests/unit/workspaces-store.test.ts tests/unit/workspace-session.test.ts
  - pnpm exec playwright test tests/e2e/work-mode-intensity.spec.ts tests/e2e/effort-intensity-smoke.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Chat send payloads no longer require `workMode` as a behavior preset, long-term state, or ability toggle.
  - Any remaining legacy `workMode` data is migration/read-only compatibility only and cannot drive permissions, tools, Task Ledger state, Knowledge writes, `/loop`, Mission, or ClawGraph behavior.
  - New Chat intent fields use thinking intensity/reasoning effort and response intensity/context density naming, or an equivalent explicitly documented shape, and cross renderer/Main through typed host API only.
  - Thinking intensity maps to provider-supported reasoning/thinking effort only; unsupported values degrade diagnostically instead of changing model/tool authority.
  - Response intensity controls prompt/context density and answer posture only; it cannot grant MCP tools, runtime tools, Skills, Office providers, Web providers, file access, terminal access, or approval bypasses.
  - Ordinary Chat remains lightweight by default and does not create a Task Ledger root or enter checkpoint/intervention/loop state machines.
  - Task Ledger and Knowledge write failures remain best-effort and cannot fail ordinary Chat sends.
  - Work Provider and Office/Search capabilities remain explicit provider/runtime capabilities, not Work Mode authority.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This task supersedes Work Mode as a product contract. It does not remove the underlying capabilities that Work Mode previously hinted at. Files, code, terminal, MCP, Skills, Office, Web, and read-only Knowledge remain ordinary Chat capabilities governed by their real runtime permissions, providers, skills, and approvals.

The replacement model is intentionally small:

- Thinking intensity controls how much reasoning effort the selected model/runtime may spend.
- Response intensity controls how much context and response structure the assistant should prefer.

Both are untrusted preferences for a send. Neither is durable task state, a long-running phase, or an authorization boundary.
