---
lifecycleStatus: archived
id: agent-avatar-orchestration-visuals
title: Local agent avatars and orchestration wave visualization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a local, persisted DiceBear identity projection and use stable execution identity across agent management, chat, orchestration, and observability UI.
touchedAreas:
  - harness/specs/tasks/agent-avatar-orchestration-visuals.md
  - package.json
  - pnpm-lock.yaml
  - shared/agent-avatar.ts
  - shared/subagent-lifecycle.ts
  - shared/types/agent.ts
  - shared/types/observability.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/main/index.ts
  - electron/utils/agent-config.ts
  - electron/services/agents-api.ts
  - src/components/agents/**
  - src/components/layout/MainLayout.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Agents/index.tsx
  - src/pages/Chat/**
  - src/pages/Observability/**
  - src/stores/agents.ts
  - src/stores/chat.ts
  - src/stores/chat/internal.ts
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - shared/i18n/locales/**/agents.json
  - shared/i18n/locales/**/chat.json
  - tests/unit/**
  - tests/e2e/**
expectedUserBehavior:
  - Agent avatars are generated locally without requests to the public DiceBear API and remain stable across restart and rename.
  - The main agent keeps the Verse brand avatar until the user explicitly saves a DiceBear avatar.
  - Persistent agents render as avatars while temporary orchestration roles render as badges layered on the owning agent avatar.
  - Orchestration progress renders as a responsive wave timeline with stable per-node lifecycle updates, including duplicate roles.
  - Existing OpenClaw identity avatar paths, data URIs, and HTTP URLs remain compatible.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - i18n-locale-coverage
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm contract:check
  - pnpm run i18n:lint
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/agent-avatar.test.ts tests/unit/agent-config.test.ts tests/unit/host-services.test.ts tests/unit/roles-orchestration-panel.test.tsx tests/unit/chat-page-execution-graph.test.tsx
  - pnpm run test:e2e -- tests/e2e/agent-avatar-orchestration.spec.ts tests/e2e/chat-task-visualizer.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Avatar generation imports only the approved DiceBear style definitions and performs no network access.
  - Managed avatar files are written inside the agent workspace and config identity.avatar points to the managed workspace-relative SVG.
  - Reset removes only the managed override and preserves user-authored IDENTITY.md avatar content.
  - AgentSummary exposes one effective avatar projection consumed by all renderer surfaces.
  - Orchestration lifecycle events include stable run, node, role-instance, and agent identity fields while older payloads remain readable.
  - Timeline cards remain readable without page-level horizontal overflow in desktop and narrow layouts.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/clawx-design-overview.md
---

This task must preserve the existing Main-owned transport and runtime permission model. It adds identity projection and visualization only; it does not authorize cross-agent routing or change orchestration policy.
