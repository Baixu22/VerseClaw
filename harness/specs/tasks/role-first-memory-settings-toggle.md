---
lifecycleStatus: archived
id: role-first-memory-settings-toggle
title: Role-first memory runtime enablement toggle
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a Settings-controlled Role Memory enablement switch that gates runtime injection and memory mutations.
touchedAreas:
  - electron/utils/store.ts
  - electron/services/settings-api.ts
  - electron/gateway/config-sync.ts
  - openclaw_runtime/src/memory/**
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - src/pages/Settings/index.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/stores/settings.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/**
  - tests/unit/role-spawn.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/settings-page-remote-control.test.tsx
  - docs/clawx-design-overview.md
  - harness/specs/tasks/role-first-memory-settings-toggle.md
expectedUserBehavior:
  - Users can turn Role Memory on or off from Settings -> System.
  - When Role Memory is off, the Roles panel shows a disabled state instead of implying memories were deleted.
  - When Role Memory is off, role runs do not receive Role Memory context and memory edits are rejected clearly.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/host-services.test.ts tests/unit/settings-page-remote-control.test.tsx
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Settings persists roleMemoryEnabled with a default enabled value.
  - Gateway launch receives OPENCLAW_ROLE_MEMORY_ENABLED from the persisted setting.
  - Role spawn does not inject Role Memory or record injection logs while disabled.
  - Mutating memory RPCs are rejected with an explicit disabled message while disabled.
  - Read memory RPCs return safe empty/disabled state while disabled.
  - Role Memory UI exposes the switch and shows a disabled state without deleting existing data.
docs:
  required: true
  note: Update docs/clawx-design-overview.md with the enablement boundary.
---

# Role Memory Settings Toggle

Role Memory remains the governed runtime context layer. The Settings toggle controls whether that layer participates in runtime behavior; it must not delete `role-memory.sqlite` data and must not mutate native OpenClaw memory.

The disabled state is a hard runtime gate, not a cosmetic UI state:

- role-spawn skips Role Memory resolution and injection;
- mutation RPCs fail clearly;
- read RPCs return safe disabled/empty payloads;
- Settings changes restart a running Gateway so the child process receives the new environment.
