---
lifecycleStatus: in_progress
id: memory-user-surface
title: Unify Memory into one governed user surface
program: long-session-development-20261022
taskKey: TF-0498
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close TF-0498 by giving users one Memory surface for accepted memory, persisted candidates, approval, deletion, export, and explicit “Remember this” proposal creation while keeping every mutation with its existing owner.
dependsOnTasks:
  - TF-0493
  - TF-0497
diffBase: 52f776260
ownedPaths:
  - harness/specs/tasks/memory-user-surface.md
  - docs/dev/memory-control-plane.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - shared/types/memory.ts
  - shared/host-api/contract.ts
  - electron/services/memory-api.ts
  - electron/services/workspace-permissions.ts
  - electron/main/ipc-handlers.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods/memory-surface.ts
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Memory/index.tsx
  - src/pages/Agents/index.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/lib/host-api.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - shared/i18n/locales/en/common.json
  - shared/i18n/locales/zh/common.json
  - shared/i18n/locales/ja/common.json
  - shared/i18n/locales/ru/common.json
  - tests/unit/memory-api.test.ts
  - tests/unit/memory-surface.test.tsx
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/workspace-permissions.test.ts
  - tests/unit/memory-surface-runtime.test.ts
  - tests/e2e/memory-surface.spec.ts
  - tests/e2e/role-memory-panel.spec.ts
  - tests/e2e/agents-propose-facts-confirm.spec.ts
  - harness/specs/fixtures/memory-user-surface/**
touchedAreas:
  - harness/specs/tasks/memory-user-surface.md
  - docs/dev/memory-control-plane.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - shared/types/memory.ts
  - shared/host-api/contract.ts
  - electron/services/memory-api.ts
  - electron/services/workspace-permissions.ts
  - electron/main/ipc-handlers.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods/memory-surface.ts
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Memory/index.tsx
  - src/pages/Agents/index.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/lib/host-api.ts
  - shared/i18n/locales
  - tests/unit/memory-api.test.ts
  - tests/unit/memory-surface.test.tsx
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/workspace-permissions.test.ts
  - tests/unit/memory-surface-runtime.test.ts
  - tests/e2e/memory-surface.spec.ts
  - tests/e2e/role-memory-panel.spec.ts
  - tests/e2e/agents-propose-facts-confirm.spec.ts
  - harness/specs/fixtures/memory-user-surface/**
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - active-config-guards
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - One Memory destination lists accepted memory and pending candidates without presenting Role, Runtime, embedding, and Dreaming stores as separate user memories.
  - Every accepted row explains source, scope, timestamp, sensitivity, state, and why it is model-visible; candidates are visibly non-injectable until approved.
  - Approve, delete/tombstone, export, and “Remember this” are available in the same panel and go through typed Host API calls.
  - Disabling Role Memory or leaving Runtime Memory candidate capture disabled is shown as a real capability boundary; retained on-disk records are not described as injected.
requiredTests:
  - pnpm exec vitest run tests/unit/memory-api.test.ts tests/unit/memory-surface.test.tsx tests/unit/memory-surface-runtime.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/workspace-permissions.test.ts --maxWorkers=1
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/memory-surface.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/memory-user-surface.md
  - git diff --check
plannedTests:
  - tests/unit/memory-surface.test.tsx
  - tests/unit/memory-api.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/workspace-permissions.test.ts
  - tests/unit/memory-surface-runtime.test.ts
  - tests/e2e/memory-surface.spec.ts
  - tests/e2e/role-memory-panel.spec.ts
  - tests/e2e/agents-propose-facts-confirm.spec.ts
acceptance:
  - 用户仅通过一个 Memory 面板完成查看、批准、删除和导出。
  - 未经批准的 candidate 不进入检索、prompt 或模型可用记忆；候选队列自身可持久化。
  - 关闭语义与全部生产消费者一致；若 legacy 仍可注入，UI/模型必须明确说明。
  - 模型中只展示已批准记忆，能正确解释 candidate 与 accepted memory 区别。
  - Approve/delete/export/remember journeys and disabled/backend-unavailable/duplicate negative states are covered by unit and built Electron evidence through Host and Gateway owners.
docs:
  required: true
  files:
    - docs/dev/memory-control-plane.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

# Unify Memory into one governed user surface

TF-0498 consumes TF-0497's `MemoryControlPlaneManifest/v1`. It adds no second memory store, candidate store, review authority, embedding path, or model context source.

## Contract

1. `/memory` is the single product destination for Memory. Other product surfaces link to it instead of reproducing its review controls.
2. Accepted Role cards and accepted Runtime facts are projected behind one read model. The projection preserves each row's owner, scope, timestamps, sensitivity, verification/state, and model visibility.
3. Pending Role proposals and Runtime fact candidates remain in their existing persisted queues. They carry `injectable=false` and `retrieval=none`; approval delegates to `role-memory-card-governance` or the Runtime Memory owner-convergence path.
4. Delete means the owning deletion path: Role cards are tombstoned; Runtime facts are invalidated through Runtime Memory. Export is a bounded, sanitized snapshot generated from the same read model, not a second state source.
5. “Remember this” creates a draft through `memory.propose`, so the existing gatekeeper/policy/evidence/conflict path decides accept or review. The UI never writes accepted memory directly.
6. Role Memory off means its records can remain on disk but are neither read for injection nor mutable. Runtime candidate capture/read/injection availability is reported from Runtime Memory flags; the UI does not infer one switch from another.
7. A candidate may never be rendered as accepted or model-visible. The model-facing projection contains accepted rows only, while the user surface separately explains that candidates are review queue entries.

## Required journeys

- accepted view -> approve candidate -> accepted read-back;
- accepted view -> delete/tombstone -> removed/non-injectable read-back;
- export -> disk artifact -> SHA-256 and content read-back;
- Remember this -> proposal/duplicate/needs-review -> candidate queue, never direct acceptance;
- Role Memory off, candidate capture off, Gateway unavailable, and duplicate proposal paths remain explicit.

## Evidence

Curated evidence belongs under `harness/specs/fixtures/memory-user-surface/` and records `driven_by: agent`, actor, source candidate identity, exact commands/results, real Electron journey screenshots, disk read-back, negatives, cleanup, and untested boundaries.
