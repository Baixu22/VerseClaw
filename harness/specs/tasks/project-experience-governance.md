---
id: project-experience-governance
title: TF-0687 Govern mission experience through accepted memory owners
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 40bf8b32f
intent: Bind Mission experience to its actual session and prove candidate review, use, revocation and bounded evaluation through existing memory owners.
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - context-family-boundary
  - error-governance-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/agents/mission-control/controller.ts
  - openclaw_runtime/src/agents/simple-completion-transport.ts
  - shared/host-api/host-action-timeouts.ts
  - shared/host-api/host-deadline.ts
  - electron/gateway/manager.ts
  - electron/main/ipc/host-invoke.ts
  - electron/main/index.ts
  - electron/services/gateway-api.ts
  - electron/services/task-ledger-service.ts
  - shared/task-system/event-store.ts
  - src/lib/host-api-client.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/context-engine/role-memory-context-provider.ts
  - openclaw_runtime/src/memory/memory-card.ts
  - openclaw_runtime/src/memory/context-pack.ts
  - openclaw_runtime/src/memory/memory-store.ts
  - openclaw_runtime/src/plugins/provider-public-artifacts.ts
  - tests/unit/provider-policy-ownership.test.ts
  - tests/unit/mission-control-loop.test.ts
  - tests/unit/project-experience-governance.test.ts
  - tests/unit/host-action-timeouts.test.ts
  - tests/unit/r0-4-host-invoke-timeout.test.ts
  - tests/unit/r0-4-host-api-client-timeout.test.ts
  - tests/unit/gateway-permissions-api.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/role-memory-context-provider.test.ts
  - tests/unit/task-ledger-lifecycle.test.ts
  - tests/unit/task-ledger-service.test.ts
  - tests/unit/durable-task-event-store.test.ts
  - tests/unit/role-spawn.test.ts
  - tests/unit/error-governance-boundary.test.ts
  - tests/unit/fp-p1-host-bridge-deadline.test.ts
  - tests/unit/roles-orchestration-panel.test.tsx
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/project-experience-governance.spec.ts
  - tests/e2e/mission-control-panel.spec.ts
  - harness/specs/tasks/project-experience-governance.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/fixtures/autonomous-project-system/m2/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - Mission outcomes create scoped candidates with source references and expiry; acceptance remains with the existing memory governance owner.
  - Accepted experience is available only in its originating session; archived, expired and superseded content stops appearing in subsequent context reads.
  - Agent-driven canary review uses the same governance path and never changes default automatic writeback or injection settings.
acceptance:
  - Success and failure candidates retain mission/run evidence, actual session scope, sensitivity and bounded TTL, remaining invisible before acceptance.
  - Actual memory owner proposal/review/context-provider/withdrawal flows preserve isolation and reject prompt injection, secrets and conflicting unsafe promotion.
  - Held-out fixture tasks compare before/after retrieval coverage and token cost using the existing memory evaluator; model quality remains a separately measured result.
  - Revocation and replacement invalidate subsequent run inputs, including reads through the same provider object.
  - The Gateway journey consumes a Mission-produced episode with its original review, role, session and 24-hour lifetime. Strong matches cannot reactivate expired cold cards.
  - A bounded mission.run uses the shared long-action budget through renderer, Main and Gateway RPC when its caller omits a timeout; explicit RPC limits and unrelated method defaults remain effective.
  - Mission and Task Loop ledger batches serialize concurrent updates, retain original creation facts across host restarts, and replay after a transactional write failure without duplicate events or changed identities.
  - Mission and Task Loop lifecycle updates preserve distinct event batches. The Gateway journey reads the existing ledger export, verifies unique creation and session-link events plus multiple phase digests, and records zero failed ledger writes.
  - Only lifecycle events from the panel's current session establish its Mission identity. A pending request keeps pause/cancel available after that identity arrives; accepted control state survives a delayed run response, and duplicate control submissions remain disabled.
  - The Runtime owner retains accepted pause, cancel and resume state when an in-flight Task Loop, reviewer or rollback settles or fails. It preserves the older tick's execution evidence, ends its trace, releases its existing fencing claim and leaves a newer tick intact.
  - Compiled Gateway control journeys hold a real child model request, accept pause or cancel while Mission execution is pending, then release the child and read the settled Mission plus its persisted state. The superseded tick does not invoke the Mission reviewer.
  - Changing the default Agent or its session clears the prior Mission projection. Delayed run/control responses and their cleanup cannot replace the new session's result or busy state.
  - Opening the panel reads the role catalog once; an empty catalog stays settled until the next open or explicit refresh.
  - Gateway budget exhaustion returns TIMEOUT with the enforcing layer's deadline metadata; an expired logical deadline dispatches no socket request. Budget selection follows the same trimmed method names as RPC dispatch.
  - The Electron Host bridge creates a fresh logical deadline for each request and preserves timeout details. Memory lifecycle stages read the prior run's terminal receipt and idle session before starting the next turn.
  - The memory journey waits for the Mission's admitted child sessions and parent session to become idle before querying its episode, preserving the original per-query deadline.
  - Before the first episode query, the journey reads current-generation completion batches and requires terminal execution plus settled delivery receipts for the Mission's admitted children. Pending or unknown delivery keeps that preflight open.
  - Fixed candidate tests and an actual Gateway memory lifecycle journey provide agent-labelled evidence with no silent failures or skips.
  - Repeated thinking and session-history queries reuse the existing bundled provider ownership metadata until the bundled root changes. Explicit registries remain authoritative for configuration validation, keeping the completion-delivery preflight within its original deadline.
requiredTests:
  - pnpm exec vitest run tests/unit/provider-policy-ownership.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/fp-p1-host-bridge-deadline.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/roles-orchestration-panel.test.tsx --maxWorkers=1
  - pnpm exec vitest run tests/unit/mission-control-loop.test.ts tests/unit/project-experience-governance.test.ts tests/unit/role-memory-v2.test.ts tests/unit/role-memory-context-provider.test.ts tests/unit/role-memory-eval-pack.test.ts tests/unit/host-action-timeouts.test.ts tests/unit/r0-4-host-invoke-timeout.test.ts tests/unit/r0-4-host-api-client-timeout.test.ts tests/unit/gateway-permissions-api.test.ts tests/unit/gateway-manager-heartbeat.test.ts tests/unit/memory-authority-contract.test.ts tests/unit/task-ledger-lifecycle.test.ts tests/unit/task-ledger-service.test.ts tests/unit/durable-task-event-store.test.ts tests/unit/role-spawn.test.ts tests/unit/error-governance-boundary.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/project-experience-governance.spec.ts tests/e2e/mission-control-panel.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/project-experience-governance.md
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

Use Mission's existing candidate producers and Role Memory governance. Do not
introduce a memory store, evaluator or approval bypass. The canary explicitly uses
agent actors and fixture-scoped policy; production defaults remain unchanged.
