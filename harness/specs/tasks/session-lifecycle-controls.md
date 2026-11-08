---
lifecycleStatus: active
id: session-lifecycle-controls
title: Fence session lifecycle controls and preserve recoverable views
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 95b876f27
intent: Complete the existing session/task UI contract through owner-backed, generation-scoped results.
ownedPaths:
  - shared/host-api/contract.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/components/chat/ResourceChip.tsx
  - src/stores/session-activity.ts
  - docs/dev/session-lifecycle-control-matrix.md
  - tests/unit/session-lifecycle-control-scope.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - harness/specs/tasks/session-lifecycle-controls.md
  - shared/i18n/locales/**/chat.json
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - shared/host-api/contract.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/components/chat/ResourceChip.tsx
  - src/stores/session-activity.ts
  - docs/dev/session-lifecycle-control-matrix.md
  - tests/unit/session-lifecycle-control-scope.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - harness/specs/tasks/session-lifecycle-controls.md
  - shared/i18n/locales/**/chat.json
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Admission, actual execution, report delivery, task acceptance and parent continuation remain distinct.
  - Current session/workspace/generation scopes reject stale results and unavailable owner actions.
  - Read failures stay visible and preserve draft, transcript and evidence references.
acceptance:
  - Apply the complete U4 or U5 contract from session-derivation-ui-design and its Task Forest node.
  - Use canonical host actions and current owner receipts; do not infer task acceptance from text or a finished run.
  - Stop, pause, archive, delete and context restore retain their distinct scopes and recovery behavior.
  - Existing child sessions remain reachable after source archive/delete; no implicit subtree action is added.
  - Four-locale Electron journeys and focused negative tests identify the same candidate and agent actor.
requiredTests:
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/session-derivation-ui.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/session-lifecycle-controls.md
  - pnpm harness run --spec harness/specs/tasks/session-lifecycle-controls.md --dry-run
docs:
  required: true
  files:
    - docs/modules/multi-agent-and-tasks.md
---

The original session UI contract remains the acceptance source. Its required cases
are retained in the aggregate journey inventory; this spec only narrows ownership.
