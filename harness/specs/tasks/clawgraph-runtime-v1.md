---
lifecycleStatus: archived
id: clawgraph-runtime-v1
title: ClawGraph Runtime v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add workspace YAML orchestration that compiles to an agent-neutral IR, runs stateless role workers through the runtime, audits handoffs, and exposes run state through the typed Host API and Verse Claw UI.
touchedAreas:
  - shared/types/clawgraph.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/services/clawgraph-api.ts
  - electron/main/ipc-handlers.ts
  - electron/gateway/event-dispatch.ts
  - openclaw_runtime/src/agents/clawgraph/**
  - openclaw_runtime/src/gateway/server-methods/clawgraph-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/pages/ClawGraph/**
  - shared/i18n/locales
expectedUserBehavior:
  - Users can open ClawGraph from the sidebar.
  - The page lists `.clawx/clawgraph/*.yaml` workflow files from the active workspace.
  - Selecting a workflow shows compile diagnostics without renderer-direct Gateway calls.
  - Starting a workflow launches a runtime run anchored to the current session.
  - The page shows node DAG state, append-only run events, and open review items.
  - Approve/reject review actions go through the Host API and Gateway permission path.
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
  - pnpm exec vitest run tests/unit/clawgraph-compiler.test.ts tests/unit/clawgraph-runtime.test.ts tests/unit/host-api-facade.test.ts
  - pnpm exec playwright test tests/e2e/clawgraph.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - YAML schema validation catches unknown roles/models, duplicate node ids, missing dependencies, cycles, and invalid sandbox values.
  - `clawgraph.*` Gateway methods are described with read/write scopes and are advertised through the runtime method table.
  - Renderer uses `hostApi.clawGraph.*` only; it does not read workflow files directly.
  - Main verifies workflow source paths are inside the active workspace `.clawx/clawgraph` directory.
  - Workers are stateless and must return a fenced `clawgraph_handoff` JSON object.
  - Audit failures and invalid handoffs create review items rather than automatically marking long-term goals complete.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

ClawGraph is an orchestration layer, not a replacement for Task Ledger. ClawGraph owns execution state and evidence; Task Ledger remains the workspace-level long-task record and user-review surface.
