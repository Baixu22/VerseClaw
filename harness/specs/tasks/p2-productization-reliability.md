---
id: p2-productization-reliability
title: P2 Productization Reliability Boundaries
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Productize existing P2 reliability, recovery, compaction, role, memory, and UI-depth surfaces without claiming automatic, global, or complete guarantees.
touchedAreas:
  - harness/specs/tasks/p2-productization-reliability.md
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/pages/Chat
  - src/components/agents
  - src/pages/Settings
  - electron/services
  - shared/host-api/contract.ts
  - shared/capability-claims.ts
  - shared/reliability-boundaries.ts
  - shared/i18n/locales/**/agents.json
  - shared/i18n/locales/**/chat.json
  - tests/unit/host-api-facade.test.ts
  - tests/unit/compaction-artifact-viewer.test.tsx
  - tests/unit/roles-api.test.ts
  - tests/unit/roles-orchestration-panel.test.tsx
  - tests/e2e/compaction-artifact-viewer.spec.ts
  - tests/e2e/role-management.spec.ts
expectedUserBehavior:
  - Chat exposes a manual compaction evidence viewer when compression artifact evidence exists, showing summary, objective, current state, warnings, unverified claims, review-needed items, and evidence labels.
  - Chat recovery actions from the compaction artifact viewer prepare a reviewable handoff context or fork/branch the session through existing continuity actions; the UI does not claim lossless restore.
  - Agents role management shows built-in versus config role origins, lets users create or edit only config-backed roles, and saves through the typed host-api boundary.
  - After saving a config role, the UI refreshes roles.list and shows a pending runtime refresh state when the Gateway role catalog has not yet reflected the saved role.
  - P2 reliability surfaces remain auxiliary, visible, and manually entered; they do not claim automatic global rollback, complete recovery, auto memory writes, or global idempotency.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/rollback-plan.test.ts
  - tests/unit/capability-claims.test.ts
acceptance:
  - Renderer code MUST call host-api/api-client instead of direct IPC or Gateway HTTP.
  - New user-visible text MUST be covered in en, zh, ja, and ru locale files.
  - P2 recovery, compaction, role, memory, and UI-depth surfaces MUST NOT claim automatic, global, complete, or lossless behavior unless proven by runtime evidence.
  - P2-01 checkpoint fingerprint and tool result evidence MUST remain intact and only be consumed by recovery surfaces.
  - User-visible UI changes MUST include focused Electron E2E coverage.
docs:
  required: true
---

## Productization boundary

This task connects existing partial P2 capabilities to product surfaces. It must prefer the smallest existing entrypoints over new architecture.

## Out of scope

- Global automatic rollback for arbitrary file, command, or external side effects.
- Lossless compaction or complete recovery from summaries.
- Full role lifecycle management beyond config-backed create/edit.
- Automatic user-skill inference for Basic/Advanced mode.
- Global retry or idempotency guarantees.
